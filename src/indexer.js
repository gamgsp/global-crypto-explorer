const rpc = require('./rpc');
const db = require('./db');

let isIndexing = false;

// Query daemon RPC getaddressbalance for exact LevelDB ground-truth
async function fetchAndSaveAddressBalances(addressList) {
  if (!addressList || addressList.length === 0) return;
  const unique = Array.from(new Set(addressList.filter(a => typeof a === 'string' && a.length >= 26)));
  if (unique.length === 0) return;

  const chunkSize = 25;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    await Promise.all(chunk.map(async (addr) => {
      try {
        const balData = await rpc.call('getaddressbalance', [{ addresses: [addr] }]);
        if (balData && typeof balData.balance === 'number') {
          const bal = balData.balance / 1e8;
          const rec = (balData.received || balData.balance) / 1e8;
          db.saveAddressBalance(addr, bal, rec, Math.max(0, rec - bal), 1);
        }
      } catch (err) {
        // Continue if address not in index
      }
    }));
  }
}

// 1. Fast Block Headers Indexer for 30-Day continuous chart stats
// Uses verbosity=1 (fast headers + txids), executes backwards from tip downwards in parallel batches
async function fastBootstrapChartHistory(tip, targetDays = 35) {
  // At ~350-400 blocks/day, 35 days is ~14,000 blocks
  const targetBlocks = targetDays * 400;
  const startH = Math.max(1, tip - targetBlocks);

  // Check how many blocks we have in this window
  const countRow = db.db.prepare('SELECT COUNT(1) as c FROM blocks WHERE height >= ?').get(startH);
  const currentCount = countRow ? countRow.c : 0;
  if (currentCount >= targetBlocks * 0.85) {
    return; // Already populated
  }

  console.log(`[Indexer] Fast bootstrapping ${targetDays}-Day chart history (${tip} down to ${startH})...`);

  const chunkSize = 50;
  // Index BACKWARDS from tip downwards so the most recent 30 days are filled first!
  for (let h = tip; h >= startH; h -= chunkSize) {
    const chunkStart = Math.max(startH, h - chunkSize + 1);
    const chunkEnd = h;
    const heights = [];
    for (let i = chunkEnd; i >= chunkStart; i--) {
      heights.push(i);
    }

    try {
      // Find heights in this chunk not yet in database
      const existingRows = db.db.prepare('SELECT height FROM blocks WHERE height >= ? AND height <= ?').all(chunkStart, chunkEnd);
      const existingSet = new Set(existingRows.map(r => r.height));
      const missingHeights = heights.filter(ht => !existingSet.has(ht));

      if (missingHeights.length === 0) continue;

      const blocks = await Promise.all(missingHeights.map(ht => rpc.getBlock(ht, 1).catch(() => null)));
      const insertStmt = db.stmts.insertBlock;
      const insertMany = db.db.transaction((blks) => {
        for (const b of blks) {
          if (!b) continue;
          insertStmt.run({
            height: b.height,
            hash: b.hash,
            time: b.time,
            tx_count: Array.isArray(b.tx) ? b.tx.length : 0,
            size: b.size || 0,
            difficulty: b.difficulty || 0,
          });
        }
      });
      insertMany(blocks.filter(Boolean));
    } catch (err) {
      console.error(`[Indexer] Error during fast chart bootstrap chunk ${chunkStart}-${chunkEnd}:`, err.message);
    }
  }
  console.log(`[Indexer] Fast 30-Day chart history bootstrap completed.`);
}

// 2. Early Whale Movements & Genesis Distribution Bootstrap (Blocks 1 to 500)
// Indexes all premine / whale transactions (each with 5,000,000 GSPC) into txs table and addresses table
async function bootstrapWhaleMovements(tip) {
  const whaleCountRow = db.db.prepare('SELECT COUNT(1) as c FROM txs WHERE total_out >= 1000000').get();
  if (whaleCountRow && whaleCountRow.c >= 50) {
    return; // Already populated
  }

  const endH = Math.min(500, tip);
  console.log(`[Indexer] Bootstrapping Whale Movements & Premine Blocks (1 to ${endH})...`);

  const chunkSize = 25;
  const addressesToQuery = new Set();

  for (let h = 1; h <= endH; h += chunkSize) {
    const chunkEnd = Math.min(endH, h + chunkSize - 1);
    const heights = [];
    for (let i = h; i <= chunkEnd; i++) heights.push(i);

    try {
      const blocks = await Promise.all(heights.map(ht => rpc.getBlock(ht, 2).catch(() => null)));
      const records = [];

      for (const b of blocks) {
        if (!b) continue;
        const txs = [];
        if (Array.isArray(b.tx)) {
          for (const tx of b.tx) {
            let totalOut = 0;
            const isTxObj = typeof tx === 'object' && tx !== null;
            const txid = isTxObj ? tx.txid : String(tx);
            const vinCount = isTxObj && Array.isArray(tx.vin) ? tx.vin.length : 0;
            const voutCount = isTxObj && Array.isArray(tx.vout) ? tx.vout.length : 0;

            if (isTxObj && Array.isArray(tx.vout)) {
              for (const out of tx.vout) {
                const val = parseFloat(out.value || 0);
                totalOut += val;
                if (out.scriptPubKey && Array.isArray(out.scriptPubKey.addresses)) {
                  for (const addr of out.scriptPubKey.addresses) {
                    addressesToQuery.add(addr);
                    db.recordAddressTx(addr, txid, b.height, val, 'COINBASE', b.time);
                  }
                }
              }
            }

            txs.push({
              txid,
              blockheight: b.height,
              blockhash: b.hash,
              time: b.time,
              total_out: totalOut,
              vin_count: vinCount,
              vout_count: voutCount,
            });
          }
        }
        records.push({ b, txs });
      }

      // Save blocks and txs in bulk
      const insertTxStmt = db.stmts.insertTx;
      const insertBlockStmt = db.stmts.insertBlock;
      const saveBatch = db.db.transaction((recs) => {
        for (const { b, txs } of recs) {
          insertBlockStmt.run({
            height: b.height,
            hash: b.hash,
            time: b.time,
            tx_count: Array.isArray(b.tx) ? b.tx.length : 0,
            size: b.size || 0,
            difficulty: b.difficulty || 0,
          });
          for (const tx of txs) {
            insertTxStmt.run(tx);
          }
        }
      });
      saveBatch(records);
    } catch (err) {
      console.error(`[Indexer] Error indexing early blocks ${h}-${chunkEnd}:`, err.message);
    }
  }

  // Update real LevelDB balances for all early whale addresses found
  if (addressesToQuery.size > 0) {
    await fetchAndSaveAddressBalances(Array.from(addressesToQuery));
  }
  console.log(`[Indexer] Whale Movements bootstrap complete.`);
}

// 3. Deep Transaction Indexer for recent blocks
async function indexRecentBlockRange(startHeight, endHeight) {
  const chunkSize = 25;
  for (let h = startHeight; h <= endHeight; h += chunkSize) {
    const chunkEnd = Math.min(endHeight, h + chunkSize - 1);
    const heights = [];
    for (let i = h; i <= chunkEnd; i++) heights.push(i);

    try {
      const blocks = await Promise.all(heights.map(ht => rpc.getBlock(ht, 2).catch(() => null)));
      const records = [];
      const addrs = new Set();

      for (const b of blocks) {
        if (!b) continue;
        const txs = [];
        if (Array.isArray(b.tx)) {
          for (const tx of b.tx) {
            let totalOut = 0;
            const isTxObj = typeof tx === 'object' && tx !== null;
            const txid = isTxObj ? tx.txid : String(tx);
            const vinCount = isTxObj && Array.isArray(tx.vin) ? tx.vin.length : 0;
            const voutCount = isTxObj && Array.isArray(tx.vout) ? tx.vout.length : 0;

            if (isTxObj && Array.isArray(tx.vout)) {
              for (const out of tx.vout) {
                const val = parseFloat(out.value || 0);
                totalOut += val;
                if (out.scriptPubKey && Array.isArray(out.scriptPubKey.addresses)) {
                  for (const addr of out.scriptPubKey.addresses) {
                    addrs.add(addr);
                    db.recordAddressTx(addr, txid, b.height, val, 'RECEIVED', b.time);
                  }
                }
              }
            }

            txs.push({
              txid,
              blockheight: b.height,
              blockhash: b.hash,
              time: b.time,
              total_out: totalOut,
              vin_count: vinCount,
              vout_count: voutCount,
            });
          }
        }
        records.push({ b, txs });
      }

      const insertTxStmt = db.stmts.insertTx;
      const insertBlockStmt = db.stmts.insertBlock;
      const saveBatch = db.db.transaction((recs) => {
        for (const { b, txs } of recs) {
          insertBlockStmt.run({
            height: b.height,
            hash: b.hash,
            time: b.time,
            tx_count: Array.isArray(b.tx) ? b.tx.length : 0,
            size: b.size || 0,
            difficulty: b.difficulty || 0,
          });
          for (const tx of txs) {
            insertTxStmt.run(tx);
          }
        }
      });
      saveBatch(records);

      if (addrs.size > 0) {
        await fetchAndSaveAddressBalances(Array.from(addrs));
      }
    } catch (err) {
      console.error(`[Indexer] Error indexing recent range ${h}-${chunkEnd}:`, err.message);
    }
  }
}

// Background sync loop: syncs newly mined blocks & performs initial bootstrap
async function syncBlockchain() {
  if (isIndexing) return;
  isIndexing = true;

  try {
    const tip = await rpc.getBlockCount();
    if (tip === null || tip === undefined || tip <= 0) {
      isIndexing = false;
      return;
    }

    // 1. Fast 30-Day Chart History (Runs backwards from tip: fills missing blocks within seconds)
    await fastBootstrapChartHistory(tip, 35);

    // 2. Early Whale Movements & Premine Blocks 1..500 (>1M GSPC transfers)
    await bootstrapWhaleMovements(tip);

    // 3. Deep Recent Transactions (~1000 blocks)
    const currentMax = db.getMaxBlockHeight() || 0;
    const recentStart = Math.max(1, tip - 1000);
    const recentCount = db.db.prepare('SELECT COUNT(1) as c FROM txs WHERE blockheight >= ?').get(recentStart)?.c || 0;
    if (recentCount < 500) {
      await indexRecentBlockRange(recentStart, tip);
    } else if (tip > currentMax) {
      // Catch up any newly mined blocks
      await indexRecentBlockRange(currentMax + 1, tip);
    }
  } catch (err) {
    console.error('[Indexer] Sync error:', err.message);
  } finally {
    isIndexing = false;
  }
}

function startIndexer() {
  syncBlockchain();
  // Poll frequently (every 10s) to keep SQLite in sync with daemon in real time
  setInterval(syncBlockchain, 10000);
}

module.exports = {
  startIndexer,
  syncBlockchain,
  fastBootstrapChartHistory,
  bootstrapWhaleMovements,
  indexRecentBlockRange,
  fetchAndSaveAddressBalances,
};
