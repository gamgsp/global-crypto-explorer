const express = require('express');
const router = express.Router();
const rpc = require('../rpc');
const db = require('../db');
const { calculateMoneySupply } = require('../supply');

// Enable CORS for all API calls
router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// 1. getdifficulty
router.get('/getdifficulty', async (req, res) => {
  try {
    const diff = await rpc.getDifficulty();
    res.send(typeof diff === 'number' ? diff.toString() : (diff || '0'));
  } catch (err) {
    res.status(503).send({ error: 'Daemon offline or unreachable' });
  }
});

// 2. getconnectioncount
router.get('/getconnectioncount', async (req, res) => {
  try {
    const count = await rpc.getConnectionCount();
    res.send((count !== null && count !== undefined ? count : 0).toString());
  } catch (err) {
    res.status(503).send({ error: 'Daemon offline or unreachable' });
  }
});

// 3. getblockcount
router.get('/getblockcount', async (req, res) => {
  try {
    const count = await rpc.getBlockCount();
    res.send((count !== null && count !== undefined ? count : 0).toString());
  } catch (err) {
    res.status(503).send({ error: 'Daemon offline or unreachable' });
  }
});

// 4. getblockhash [index]
async function handleGetBlockHash(req, res) {
  try {
    const index = req.query.index !== undefined ? req.query.index : req.params.index;
    if (index === undefined || index === '') {
      return res.status(400).send({ error: 'Missing index parameter' });
    }
    const hash = await rpc.getBlockHash(index);
    res.send(hash);
  } catch (err) {
    res.status(404).send({ error: 'Block not found' });
  }
}
router.get('/getblockhash', handleGetBlockHash);
router.get('/getblockhash/:index', handleGetBlockHash);

// 5. getblock [hash]
async function handleGetBlock(req, res) {
  try {
    const hash = req.query.hash || req.params.hash;
    if (!hash) {
      return res.status(400).send({ error: 'Missing hash parameter' });
    }
    const block = await rpc.getBlock(hash, 1);
    res.json(block);
  } catch (err) {
    res.status(404).send({ error: 'Block not found' });
  }
}
router.get('/getblock', handleGetBlock);
router.get('/getblock/:hash', handleGetBlock);

// 6. getrawtransaction [txid] [decrypt]
async function handleGetRawTx(req, res) {
  try {
    const txid = req.query.txid || req.params.txid;
    const decrypt = req.query.decrypt !== undefined ? parseInt(req.query.decrypt, 10) : 0;
    if (!txid) {
      return res.status(400).send({ error: 'Missing txid parameter' });
    }
    const tx = await rpc.getRawTransaction(txid, decrypt);
    if (decrypt === 1) {
      res.json(tx);
    } else {
      res.send(typeof tx === 'string' ? tx : JSON.stringify(tx));
    }
  } catch (err) {
    res.status(404).send({ error: 'Transaction not found' });
  }
}
router.get('/getrawtransaction', handleGetRawTx);
router.get('/getrawtransaction/:txid', handleGetRawTx);

// 7. getnetworkhashps
router.get('/getnetworkhashps', async (req, res) => {
  try {
    const hashps = await rpc.getNetworkHashps();
    res.send(hashps.toString());
  } catch (err) {
    res.status(503).send({ error: 'Daemon offline or unreachable' });
  }
});

// 8. getvotelist
router.get('/getvotelist', async (req, res) => {
  try {
    const votes = await rpc.call('gobject', ['list']).catch(() => []);
    res.json(Array.isArray(votes) ? votes : Object.values(votes || {}));
  } catch (err) {
    res.json([]);
  }
});

// 9. getmasternodecount
router.get('/getmasternodecount', async (req, res) => {
  try {
    const mnCount = await rpc.getMasternodeCount();
    res.json(mnCount);
  } catch (err) {
    res.json({ total: 0, enabled: 0 });
  }
});

function formatAge(timestamp) {
  if (!timestamp) return 'Just now';
  const sec = Math.max(0, Math.floor(Date.now() / 1000 - timestamp));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 365) return `${days}d ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

// 10. latest-blocks-txs (for seamless 60s in-place auto-refresh)
router.get('/latest-blocks-txs', async (req, res) => {
  try {
    const tipHeight = await rpc.getBlockCount().catch(() => 0);
    const supply = calculateMoneySupply(tipHeight);
    const [mpoolInfo, mnCount, networkHashps, connCount, difficulty] = await Promise.all([
      rpc.getMempoolInfo().catch(() => ({ size: 0 })),
      rpc.getMasternodeCount().catch(() => ({ total: 0, enabled: 0 })),
      rpc.getNetworkHashps().catch(() => 0),
      rpc.getConnectionCount().catch(() => 0),
      rpc.getDifficulty().catch(() => 0),
    ]);

    const dbBlocks = db.getRecentBlocks(20, 0);
    const blocks = (dbBlocks || []).map(b => ({
      height: b.height,
      hash: b.hash,
      txCount: b.tx_count,
      formattedSize: ((b.size || 0) / 1024).toFixed(2) + ' KB',
      age: Math.max(0, Math.floor(Date.now() / 1000 - b.time)),
      formattedAge: formatAge(b.time),
    }));

    const dbTxs = db.getRecentTransactions(20, 0);
    const txs = (dbTxs || []).map(t => {
      const val = typeof t.total_out === 'number' ? t.total_out : parseFloat(t.total_out || 0);
      return {
        txid: t.txid,
        height: t.blockheight,
        time: t.time,
        total_out: val,
        value: val > 0 ? (val >= 1000 ? val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : val.toFixed(4)) : '0.0000',
        age: Math.max(0, Math.floor(Date.now() / 1000 - t.time)),
        formattedAge: formatAge(t.time),
      };
    });

    res.json({
      success: true,
      blocks,
      txs,
      stats: {
        blockCount: tipHeight.toLocaleString(),
        rawBlockCount: tipHeight,
        mempoolSize: mpoolInfo.size || 0,
        circulatingSupply: supply.toLocaleString(undefined, { maximumFractionDigits: 2 }),
        difficulty: typeof difficulty === 'number' ? (difficulty > 0 ? difficulty.toFixed(4) : '0') : difficulty,
        hashrate: (networkHashps / 1000000).toFixed(2) + ' MH/s',
        connections: connCount || 0,
        masternodes: mnCount.enabled || 0,
        totalMasternodes: mnCount.total || 0,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
