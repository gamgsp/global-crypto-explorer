const express = require('express');
const router = express.Router();
const rpc = require('../rpc');
const { calculateMoneySupply } = require('../supply');
const { fetchPrice } = require('../market');
const { dynamicCache, addressCache } = require('../cache');
const richlistService = require('../richlist');

// Enable CORS
router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, footer-only');
  next();
});

// 1. getmoneysupply
router.get('/getmoneysupply', async (req, res) => {
  try {
    const height = await rpc.getBlockCount();
    const supply = calculateMoneySupply(height > 0 ? height : 0);
    res.send(supply.toString());
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// 2. getdistribution
router.get('/getdistribution', async (req, res) => {
  try {
    const data = await richlistService.fetchRealRichlist();
    const distribution = {
      supply: data.rawSupply,
      t_1_25: { percent: data.tiers.top1_25.percent, total: data.tiers.top1_25.amount },
      t_26_50: { percent: data.tiers.top26_50.percent, total: data.tiers.top26_50.amount },
      t_51_75: { percent: data.tiers.top51_75.percent, total: data.tiers.top51_75.amount },
      t_76_100: { percent: data.tiers.top76_100.percent, total: data.tiers.top76_100.amount },
      t_101plus: { percent: data.tiers.rest.percent, total: data.tiers.rest.amount },
    };
    res.json(distribution);
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// 3. getaddress (/ext/getaddress/hash)
router.get('/getaddress/:hash', async (req, res) => {
  try {
    const address = req.params.hash;
    const cacheKey = `addr_${address}`;
    const cached = addressCache.get(cacheKey);
    if (cached) return res.json(cached);

    const balanceData = await rpc.getAddressBalance(address);
    const balanceGspc = (balanceData.balance / 100000000).toFixed(8);
    const receivedGspc = (balanceData.received / 100000000).toFixed(8);
    const sentGspc = ((balanceData.received - balanceData.balance) / 100000000).toFixed(8);

    // Get recent transactions via deltas or utxos
    let lastTxs = [];
    try {
      const deltas = await rpc.getAddressDeltas(address);
      if (Array.isArray(deltas)) {
        lastTxs = deltas.slice(-50).reverse().map(d => ({
          addresses: address,
          type: d.satoshis > 0 ? 'vout' : 'vin',
          timestamp: d.timestamp || Math.floor(Date.now() / 1000),
          amount: Math.abs(d.satoshis),
          txid: d.txid,
          blockindex: d.height,
        }));
      }
    } catch {
      // If address index is not available
    }

    const result = {
      address: address,
      sent: parseFloat(sentGspc),
      received: parseFloat(receivedGspc),
      balance: balanceGspc,
      last_txs: lastTxs,
    };

    addressCache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// 4. getaddresstxs (/ext/getaddresstxs/hash/start/length)
router.get('/getaddresstxs/:hash/:start/:length', async (req, res) => {
  try {
    const { hash, start, length } = req.params;
    const s = parseInt(start, 10) || 0;
    const l = Math.min(parseInt(length, 10) || 50, 100);

    const deltas = await rpc.getAddressDeltas(hash);
    const sliced = (Array.isArray(deltas) ? deltas.slice(s, s + l) : []).map(d => ({
      addresses: hash,
      type: d.satoshis > 0 ? 'vout' : 'vin',
      timestamp: d.timestamp || Math.floor(Date.now() / 1000),
      amount: Math.abs(d.satoshis),
      txid: d.txid,
      blockindex: d.height,
    }));

    res.json(sliced);
  } catch (err) {
    res.json([]);
  }
});

// 5. gettx (/ext/gettx/hash)
router.get('/gettx/:hash', async (req, res) => {
  try {
    const hash = req.params.hash;
    const tx = await rpc.getRawTransaction(hash, 1);
    if (!tx) {
      return res.status(404).send({ error: 'Transaction not found' });
    }

    let total = 0;
    const vout = (tx.vout || []).map(v => {
      total += (v.value || 0) * 100000000;
      return {
        addresses: v.scriptPubKey?.addresses ? v.scriptPubKey.addresses[0] : (v.scriptPubKey?.address || 'N/A'),
        amount: Math.round((v.value || 0) * 100000000),
      };
    });

    const vin = (tx.vin || []).map(v => ({
      addresses: v.coinbase ? 'coinbase' : (v.address || 'N/A'),
      amount: Math.round((v.value || 0) * 100000000),
    }));

    const result = {
      txid: tx.txid,
      vin: vin,
      vout: vout,
      total: Math.round(total),
      timestamp: tx.time || tx.blocktime || Math.floor(Date.now() / 1000),
      blockhash: tx.blockhash || '',
      blockindex: tx.height || 0,
      confirmations: tx.confirmations || 0,
    };

    res.json(result);
  } catch (err) {
    res.status(404).send({ error: 'Transaction not found' });
  }
});

// 6. getbalance (/ext/getbalance/hash)
router.get('/getbalance/:hash', async (req, res) => {
  try {
    const address = req.params.hash;
    const balanceData = await rpc.getAddressBalance(address);
    if (balanceData && typeof balanceData.balance === 'number') {
      const balance = (balanceData.balance / 100000000).toFixed(8);
      return res.send(balance);
    }
    const known = richlistService.getBalanceFromRichlist(address);
    if (known !== null) {
      return res.send(known.toFixed(8));
    }
    res.send('0.00000000');
  } catch (err) {
    res.send('0.00000000');
  }
});

// 7. getlasttxs (/ext/getlasttxs/min/start/length)
router.get('/getlasttxs/:min/:start/:length', async (req, res) => {
  try {
    const minVal = parseFloat(req.params.min) || 0;
    const start = parseInt(req.params.start, 10) || 0;
    const length = Math.min(parseInt(req.params.length, 10) || 25, 100);

    const tipHeight = await rpc.getBlockCount();
    const txs = [];

    // Scan last 15 blocks for matching transactions
    for (let h = tipHeight; h > Math.max(0, tipHeight - 15) && txs.length < start + length; h--) {
      try {
        const block = await rpc.getBlock(h, 2);
        if (block && Array.isArray(block.tx)) {
          for (const tx of block.tx) {
            let totalOut = 0;
            if (tx.vout) {
              for (const out of tx.vout) totalOut += out.value || 0;
            }
            if (totalOut >= minVal) {
              txs.push({
                txid: tx.txid,
                blockindex: block.height,
                blockhash: block.hash,
                timestamp: block.time,
                total: Math.round(totalOut * 100000000),
                recipient: tx.vout?.[0]?.scriptPubKey?.addresses?.[0] || 'N/A',
              });
            }
          }
        }
      } catch {
        continue;
      }
    }

    res.json(txs.slice(start, start + length));
  } catch (err) {
    res.json([]);
  }
});

// 8. getcurrentprice
router.get('/getcurrentprice', async (req, res) => {
  try {
    const price = await fetchPrice();
    res.json(price);
  } catch (err) {
    res.json({
      last_price_usd: '0.00',
      last_price_usdt: '0.00',
      last_price_btc: '0.00000000',
    });
  }
});

// 9. getnetworkpeers
router.get('/getnetworkpeers', async (req, res) => {
  try {
    const peers = await rpc.getPeerInfo();
    const formatted = peers.map(p => ({
      ip: p.addr,
      address: p.addr.split(':')[0],
      port: p.addr.split(':')[1] || '27653',
      version: p.version,
      subver: p.subver ? p.subver.replace(/\//g, '') : 'Gspcoin Core',
      country: 'Global',
      country_code: 'UN',
      ping: (p.pingtime ? Math.round(p.pingtime * 1000) : 0) + ' ms',
      conntime: p.conntime,
    }));
    res.json(formatted);
  } catch (err) {
    res.json([]);
  }
});

// 10. getbasicstats
router.get('/getbasicstats', async (req, res) => {
  try {
    const [height, price, mnCount] = await Promise.all([
      rpc.getBlockCount(),
      fetchPrice(),
      rpc.getMasternodeCount().catch(() => ({ total: 0 })),
    ]);
    const supply = calculateMoneySupply(height > 0 ? height : 0);

    res.json({
      blockcount: height,
      supply: supply,
      price_usd: price.last_price_usd,
      price_usdt: price.last_price_usdt,
      masternodeCount: mnCount.total || mnCount.enabled || 0,
    });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// 11. getsummary
router.get('/getsummary', async (req, res) => {
  try {
    const isFooterOnly = req.headers['footer-only'] === 'true' || req.query['footer-only'] === 'true';
    const [height, connections] = await Promise.all([
      rpc.getBlockCount(),
      rpc.getConnectionCount().catch(() => 0),
    ]);

    if (isFooterOnly) {
      return res.json({
        connections: connections,
        blockcount: height,
      });
    }

    const [diff, hashrate, price, mnCount] = await Promise.all([
      rpc.getDifficulty().catch(() => 0),
      rpc.getNetworkHashps().catch(() => 0),
      fetchPrice(),
      rpc.getMasternodeCount().catch(() => ({ total: 0, enabled: 0 })),
    ]);
    const supply = calculateMoneySupply(height > 0 ? height : 0);

    const totalMn = mnCount.total || 0;
    const onlineMn = mnCount.enabled || mnCount.stable || totalMn;
    const offlineMn = Math.max(0, totalMn - onlineMn);

    res.json({
      difficulty: typeof diff === 'number' ? diff : parseFloat(diff),
      hybrid_difficulty: typeof diff === 'number' ? diff : parseFloat(diff),
      supply: supply,
      hashrate: hashrate,
      price_usdt: price.last_price_usdt,
      price_usd: price.last_price_usd,
      connections: connections,
      blockcount: height,
      masternodes_online: onlineMn,
      masternodes_offline: offlineMn,
    });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// 12. getmasternodelist
router.get('/getmasternodelist', async (req, res) => {
  try {
    const rawList = await rpc.getMasternodeList('full');
    const result = [];
    let rank = 1;

    if (rawList && typeof rawList === 'object') {
      for (const [key, value] of Object.entries(rawList)) {
        // Parse "status protocol address lastseen activetime lastpaid lastpaidblock ip"
        const parts = typeof value === 'string' ? value.trim().split(/\s+/) : [];
        const status = parts[0] || 'ENABLED';
        const protocol = parts[1] || '70219';
        const payee = parts[2] || key;
        const lastseen = parseInt(parts[3] || '0', 10);
        const activetime = parseInt(parts[4] || '0', 10);
        const lastpaid = parseInt(parts[5] || '0', 10);
        const ip = parts[7] || parts[parts.length - 1] || 'Unknown';

        result.push({
          rank: rank++,
          network: ip.includes(':') && !ip.startsWith('[') ? 'ipv4' : 'ipv6',
          txhash: key.split('-')[0] || key,
          outidx: key.split('-')[1] || '0',
          status: status,
          addr: payee,
          version: parseInt(protocol, 10) || 70219,
          lastseen: lastseen,
          activetime: activetime,
          lastpaid: lastpaid,
          ip: ip,
        });
      }
    }

    res.json(result);
  } catch (err) {
    res.json([]);
  }
});

// 13. getmasternoderewards (/ext/getmasternoderewards/hash/since)
router.get('/getmasternoderewards/:hash/:since', async (req, res) => {
  try {
    const { hash, since } = req.params;
    const sinceHeight = parseInt(since, 10) || 0;
    const tipHeight = await rpc.getBlockCount();

    const rewards = [];
    const deltas = await rpc.getAddressDeltas(hash, sinceHeight, tipHeight);
    if (Array.isArray(deltas)) {
      for (const d of deltas) {
        if (d.satoshis > 0) {
          rewards.push({
            txid: d.txid,
            blockindex: d.height,
            amount: d.satoshis,
            timestamp: d.timestamp,
          });
        }
      }
    }
    res.json(rewards);
  } catch (err) {
    res.json([]);
  }
});

// 14. getmasternoderewardstotal (/ext/getmasternoderewardstotal/hash/since)
router.get('/getmasternoderewardstotal/:hash/:since', async (req, res) => {
  try {
    const { hash, since } = req.params;
    const sinceHeight = parseInt(since, 10) || 0;
    const tipHeight = await rpc.getBlockCount();

    let total = 0;
    const deltas = await rpc.getAddressDeltas(hash, sinceHeight, tipHeight);
    if (Array.isArray(deltas)) {
      for (const d of deltas) {
        if (d.satoshis > 0) total += d.satoshis;
      }
    }
    res.send((total / 100000000).toFixed(8));
  } catch (err) {
    res.send('0.00000000');
  }
});

module.exports = router;
