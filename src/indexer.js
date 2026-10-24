const rpc = require('./rpc');
const db = require('./db');
const config = require('./config');
const { LRUCache } = require('lru-cache');

// In-memory cache for fast prevout lookups (txid:vout -> { address, value })
const prevoutCache = new LRUCache({
  max: 50000,
});

let isIndexing = false;

// Index a single block and all its transactions & address movements
async function indexSingleBlock(height) {
  try {
    const block = await rpc.getBlock(height, 2);
    if (!block) return;

    db.stmts.insertBlock.run({
      height: block.height,
      hash: block.hash,
      time: block.time,
      tx_count: Array.isArray(block.tx) ? block.tx.length : 0,
      size: block.size || 0,
      difficulty: block.difficulty || 0,
    });

    if (Array.isArray(block.tx)) {
      for (const tx of block.tx) {
        let totalOut = 0;
        const isCoinbase = Array.isArray(tx.vin) && tx.vin.length > 0 && !!tx.vin[0].coinbase;

        // Process outputs (credits)
        if (Array.isArray(tx.vout)) {
          for (const out of tx.vout) {
            const val = parseFloat(out.value || 0);
            totalOut += val;

            if (out.scriptPubKey && Array.isArray(out.scriptPubKey.addresses)) {
              for (const addr of out.scriptPubKey.addresses) {
                let txType = 'RECEIVED';
                if (isCoinbase) {
                  if (out.n === 0) {
                    txType = 'MINED';
                  } else if (val === 60.5 || out.n === 2 || addr === 'GZBNAiLokyYvSwNLftReXuYbvdmzNoorGj') {
                    txType = 'DEV FUND';
                  } else {
                    txType = 'SMARTNODE';
                  }
                }

                db.recordAddressTx(addr, tx.txid, block.height, val, txType, block.time);
                prevoutCache.set(`${tx.txid}:${out.n}`, { address: addr, value: val });

                const existing = db.getAddress(addr);
                const curBal = existing ? existing.balance : 0;
                const curRec = existing ? existing.received : 0;
                db.saveAddressBalance(addr, curBal + val, curRec + val, existing ? existing.sent : 0, 1);
              }
            }
          }
        }

        // Process inputs (debits) - skip coinbase
        if (Array.isArray(tx.vin)) {
          for (const vin of tx.vin) {
            if (vin.coinbase) continue;

            if (vin.txid && vin.vout !== undefined) {
              const cacheKey = `${vin.txid}:${vin.vout}`;
              let prevout = prevoutCache.get(cacheKey);

              if (!prevout) {
                try {
                  const prevTx = await rpc.getRawTransaction(vin.txid, 1);
                  if (prevTx && prevTx.vout && prevTx.vout[vin.vout]) {
                    const prevOutData = prevTx.vout[vin.vout];
                    const prevVal = parseFloat(prevOutData.value || 0);
                    const prevAddr = prevOutData.scriptPubKey?.addresses?.[0];
                    if (prevAddr) {
                      prevout = { address: prevAddr, value: prevVal };
                      prevoutCache.set(cacheKey, prevout);
                    }
                  }
                } catch {}
              }

              if (prevout && prevout.address) {
                const addr = prevout.address;
                const val = prevout.value;

                db.recordAddressTx(addr, tx.txid, block.height, val, 'SENT', block.time);

                const existing = db.getAddress(addr);
                const curBal = existing ? existing.balance : 0;
                const curSent = existing ? existing.sent : 0;
                db.saveAddressBalance(addr, Math.max(0, curBal - val), existing ? existing.received : 0, curSent + val, 1);
              }
            }
          }
        }

        db.stmts.insertTx.run({
          txid: tx.txid,
          blockheight: block.height,
          blockhash: block.hash,
          time: block.time,
          total_out: totalOut,
          vin_count: Array.isArray(tx.vin) ? tx.vin.length : 0,
          vout_count: Array.isArray(tx.vout) ? tx.vout.length : 0,
        });
      }
    }
  } catch (err) {
    // Continue on individual block error
  }
}

// Background sync loop: syncs all newly mined blocks into SQLite in real-time
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

    // Fast bootstrap for recent blocks if database is fresh
    if (currentMax === 0 && tip > 0) {
      const bootstrapStart = Math.max(0, tip - 1000);
      console.log(`[Indexer] Bootstrapping blocks (${bootstrapStart} to ${tip}) into SQLite...`);
      for (let h = bootstrapStart; h <= tip; h++) {
        await indexSingleBlock(h);
      }
      currentMax = tip;
      console.log(`[Indexer] Bootstrap complete at block ${tip}`);
    }

    // Real-time catch-up: process any new blocks
    if (tip > currentMax) {
      for (let h = currentMax + 1; h <= tip; h++) {
        await indexSingleBlock(h);
      }
    }
  } catch (err) {
    // Daemon offline or syncing
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
  indexSingleBlock,
};
