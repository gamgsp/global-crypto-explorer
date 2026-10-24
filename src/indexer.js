const rpc = require('./rpc');
const db = require('./db');
const { LRUCache } = require('lru-cache');

// In-memory cache for fast prevout lookups
const prevoutCache = new LRUCache({
  max: 100000,
});

let isIndexing = false;

// Helper: Query daemon RPC getaddressbalance for exact LevelDB ground-truth
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

// Batch indexer: inserts blocks and txs in bulk inside a single SQLite transaction
const insertBlockAndTxsBatch = db.db.transaction((records) => {
  for (const { b, txs } of records) {
    db.stmts.insertBlock.run({
      height: b.height,
      hash: b.hash,
      time: b.time,
      tx_count: Array.isArray(b.tx) ? b.tx.length : 0,
      size: b.size || 0,
      difficulty: b.difficulty || 0,
    });
    for (const tx of txs) {
      db.stmts.insertTx.run(tx);
    }
  }
});

// Process a range of block heights in parallel batches
async function indexBlockRange(startHeight, endHeight, verbosity = 2) {
  const chunkSize = 50;
  for (let h = startHeight; h <= endHeight; h += chunkSize) {
    const heights = [];
    for (let i = 0; i < chunkSize && h + i <= endHeight; i++) {
      heights.push(h + i);
    }

    try {
      const blocks = await Promise.all(heights.map(ht => rpc.getBlock(ht, verbosity).catch(() => null)));
      const records = [];
      const addressesToUpdate = new Set();

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
                    addressesToUpdate.add(addr);
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

      insertBlockAndTxsBatch(records);

      // Asynchronously update address balances from native daemon
      if (addressesToUpdate.size > 0) {
        await fetchAndSaveAddressBalances(Array.from(addressesToUpdate));
      }
    } catch (batchErr) {
      console.error(`[Indexer] Error in block batch ${h}-${h+chunkSize}:`, batchErr.message);
    }
  }
}

// Background sync loop: syncs newly mined blocks & performs initial bootstrap
async function syncBlockchain() {
  if (isIndexing) return;
  isIndexing = true;

  try {
    const tip = await rpc.getBlockCount();
    if (tip === null || tip === undefined || tip < 0) {
      isIndexing = false;
      return;
    }

    let currentMax = db.getMaxBlockHeight() || 0;

    // 1. Initial 30-Day Deep Chart Bootstrap (indexes past ~22,000 blocks to cover 35 days)
    const requiredRecentBlocks = Math.min(22000, tip);
    const chartStart = Math.max(1, tip - requiredRecentBlocks);

    // Check how many blocks we have in the recent 35-day window
    const recentCountRow = db.db.prepare('SELECT COUNT(1) as c FROM blocks WHERE height >= ?').get(chartStart);
    const recentCount = recentCountRow ? recentCountRow.c : 0;

    if (recentCount < 5000) {
      console.log(`[Indexer] Bootstrapping 30-Day chart history (${chartStart} to ${tip})...`);
      await indexBlockRange(chartStart, tip, 2);
      console.log(`[Indexer] 30-Day chart bootstrap complete.`);
    }

    // 2. Initial Richlist Whale Bootstrap (scan blocks 1 to 5000 for genesis & premine whale addresses)
    const earlyCountRow = db.db.prepare('SELECT COUNT(1) as c FROM blocks WHERE height <= 5000').get();
    const earlyCount = earlyCountRow ? earlyCountRow.c : 0;

    if (earlyCount < 2000) {
      console.log(`[Indexer] Bootstrapping early blocks 1 to 5000 for complete Richlist & Whale addresses...`);
      await indexBlockRange(1, Math.min(5000, tip), 2);
      console.log(`[Indexer] Early blocks bootstrap complete.`);
    }

    // 3. Real-time catch-up: process any new blocks from daemon
    currentMax = db.getMaxBlockHeight() || 0;
    if (tip > currentMax) {
      await indexBlockRange(currentMax + 1, tip, 2);
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
  indexBlockRange,
  fetchAndSaveAddressBalances,
};
