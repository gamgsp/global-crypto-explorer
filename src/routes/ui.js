
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

const db = require('../db');
const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const rpc = require('../rpc');
const config = require('../config');
const { calculateMoneySupply } = require('../supply');
const market = require('../market');
const richlistService = require('../richlist');
const claimsService = require('../claims');

// Helper to format timestamps
function formatTime(timestamp) {
  if (!timestamp) return 'N/A';
  return new Date(timestamp * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

// 1. Dashboard (/ or /home)
router.get('/', async (req, res) => {
  try {
    const blockPage = Math.max(1, parseInt(req.query.blockPage, 10) || 1);
    const txPage = Math.max(1, parseInt(req.query.txPage, 10) || 1);
    const blocksPerPage = 20;
    const txsPerPage = 20;

    const [tipHeight, mpoolInfo, mnCount, priceData] = await Promise.all([
      rpc.getBlockCount().catch(() => 0),
      rpc.getMempoolInfo().catch(() => ({ size: 0, bytes: 0 })),
      rpc.getMasternodeCount().catch(() => ({ total: 0, enabled: 0 })),
      market.fetchPrice().catch(() => ({ last_price_usd: '0.00', last_price_btc: '0.00000000' })),
    ]);

    const supply = calculateMoneySupply(tipHeight);
    const networkHashps = await rpc.getNetworkHashps().catch(() => 0);
    const connCount = await rpc.getConnectionCount().catch(() => 0);

    const priceUsd = parseFloat(priceData.last_price_usd || 0);
    const marketCap = (priceUsd * supply).toLocaleString(undefined, { maximumFractionDigits: 2 });

    // High-speed SQLite query first (<0.1ms), falling back to RPC if bootstrapping
    let latestBlocks = [];
    let allRecentTxs = [];

    const dbBlocks = db.getRecentBlocks(blocksPerPage, (blockPage - 1) * blocksPerPage);
    if (dbBlocks && dbBlocks.length > 0) {
      latestBlocks = dbBlocks.map(b => ({
        ...b,
        age: Math.max(0, Math.floor(Date.now() / 1000 - b.time)),
        formattedAge: formatAge(b.time),
        txCount: b.tx_count,
        formattedSize: ((b.size || 0) / 1024).toFixed(2) + ' KB',
      }));

      const dbTxs = db.getRecentTransactions(txsPerPage, (txPage - 1) * txsPerPage);
      allRecentTxs = (dbTxs || []).map(t => {
        const val = typeof t.total_out === 'number' ? t.total_out : parseFloat(t.total_out || 0);
        return {
          txid: t.txid,
          height: t.blockheight,
          time: t.time,
          total_out: val,
          formattedValue: val > 0 ? (val >= 1000 ? val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : val.toFixed(4)) : '0.0000',
          age: Math.max(0, Math.floor(Date.now() / 1000 - t.time)),
          formattedAge: formatAge(t.time),
        };
      });
    } else {
      const startBlock = Math.max(0, tipHeight - (blockPage - 1) * blocksPerPage);
      for (let h = startBlock; h > Math.max(0, startBlock - blocksPerPage); h--) {
        try {
          const b = await rpc.getBlock(h, 1);
          if (b) {
            latestBlocks.push({
              ...b,
              age: Math.max(0, Math.floor(Date.now() / 1000 - b.time)),
        formattedAge: formatAge(b.time),
              txCount: b.tx ? b.tx.length : 0,
              formattedSize: ((b.size || 0) / 1024).toFixed(2) + ' KB',
            });

            if (b.tx && Array.isArray(b.tx)) {
              for (const txid of b.tx) {
                allRecentTxs.push({
                  txid,
                  height: b.height,
                  time: b.time,
                  age: Math.max(0, Math.floor(Date.now() / 1000 - b.time)),
        formattedAge: formatAge(b.time),
                });
              }
            }
          }
        } catch {}
      }
    }

    const difficulty = latestBlocks.length > 0 ? latestBlocks[0].difficulty : await rpc.getDifficulty().catch(() => 0);

    // Paginate transactions
    let totalTxPages;
    let paginatedTxs;
    if (dbBlocks && dbBlocks.length > 0) {
      const totalTxCount = db.getTransactionCount();
      totalTxPages = Math.max(1, Math.ceil(totalTxCount / txsPerPage));
      paginatedTxs = allRecentTxs; // already paginated by SQLite query
    } else {
      totalTxPages = Math.max(1, Math.ceil(allRecentTxs.length / txsPerPage));
      paginatedTxs = allRecentTxs.slice((txPage - 1) * txsPerPage, txPage * txsPerPage);
    }
    const totalBlockPages = Math.max(1, Math.ceil(tipHeight / blocksPerPage));

    res.render('index', {
      active: 'home',
      coin: config.coin,
      stats: {
        blockCount: tipHeight.toLocaleString(),
        rawBlockCount: tipHeight,
        difficulty: typeof difficulty === 'number' ? difficulty.toFixed(4) : difficulty,
        hashrate: (networkHashps / 1000000).toFixed(2) + ' MH/s',
        connections: connCount,
        mempoolSize: mpoolInfo.size || 0,
        circulatingSupply: supply.toLocaleString(undefined, { maximumFractionDigits: 2 }),
        rawSupply: supply,
        masternodes: mnCount.enabled || 0,
        totalMasternodes: mnCount.total || 0,
        priceUsd: (priceData.last_price_usd && parseFloat(priceData.last_price_usd) > 0) ? priceData.last_price_usd : '0.00',
        priceBtc: priceData.last_price_btc || '0.00000000',
        marketCap: marketCap,
      },
      latestBlocks,
      recentTxs: paginatedTxs,
      pagination: {
        blockPage,
        totalBlockPages,
        txPage,
        totalTxPages,
      },
    });
  } catch (err) {
    res.status(500).render('error', { error: 'Dashboard error: ' + err.message, coin: config.coin, active: 'home' });
  }
});

// 2. Block Details (/block/:hashOrHeight)
router.get('/block/:hashOrHeight', async (req, res) => {
  try {
    const param = req.params.hashOrHeight;
    let block;

    if (/^\d+$/.test(param)) {
      const height = parseInt(param, 10);
      const hash = await rpc.getBlockHash(height);
      block = await rpc.getBlock(hash, 2);
    } else {
      block = await rpc.getBlock(param, 2);
    }

    if (!block) {
      return res.status(404).render('error', { error: 'Block not found', coin: config.coin, active: 'block' });
    }

    const tipHeight = await rpc.getBlockCount().catch(() => block.height);
    const confirmations = tipHeight - block.height + 1;

    let blockReward = 0;
    const formattedTxs = (block.tx || []).map((t, idx) => {
      let valOut = 0;
      if (t.vout) {
        for (const out of t.vout) valOut += out.value || 0;
      }
      if (idx === 0) blockReward = valOut;
      return {
        txid: t.txid,
        isCoinbase: t.vin && t.vin[0] && !!t.vin[0].coinbase,
        vin: t.vin || [],
        vout: t.vout || [],
        total: valOut.toFixed(8),
      };
    });

    res.render('block', {
      active: 'block',
      coin: config.coin,
      block: {
        ...block,
        confirmations,
        age: Math.max(0, Math.floor(Date.now() / 1000 - block.time)),
        subsidy: blockReward.toFixed(4),
        sizeKb: ((block.size || 0) / 1024).toFixed(2),
        difficulty: typeof block.difficulty === 'number' ? block.difficulty.toFixed(6) : block.difficulty,
      },
      txs: formattedTxs,
    });
  } catch (err) {
    res.status(404).render('error', { error: 'Block lookup failed: ' + err.message, coin: config.coin, active: 'block' });
  }
});

// 3. Transaction Details (/tx/:hash)
router.get('/tx/:hash', async (req, res) => {
  try {
    const txid = req.params.hash;
    const tx = await rpc.getRawTransaction(txid, 1);
    if (!tx) {
      return res.status(404).render('error', { error: 'Transaction not found', coin: config.coin, active: 'tx' });
    }

    let totalOut = 0;
    const vout = (tx.vout || []).map(v => {
      const val = parseFloat(v.value || 0);
      totalOut += val;
      const addr = v.scriptPubKey?.addresses ? v.scriptPubKey.addresses[0] : (v.scriptPubKey?.address || 'N/A');
      const claim = claimsService.getClaim(addr);
      return {
        n: v.n,
        value: val.toFixed(8),
        amount: val.toFixed(8), // Explicit amount to fix screenshot issue
        address: addr,
        claim: claim ? claim.claim_name : null,
      };
    });

    const vin = (tx.vin || []).map((v, i) => ({
      index: i,
      coinbase: !!v.coinbase,
      txid: v.txid || null,
      vout: v.vout !== undefined ? v.vout : null,
      address: v.coinbase ? 'Coinbase (Mined Block Reward)' : (v.address || 'Standard Input'),
      amount: v.value ? parseFloat(v.value).toFixed(8) : null,
    }));

    res.render('tx', {
      active: 'tx',
      coin: config.coin,
      tx: {
        ...tx,
        totalOut: totalOut.toFixed(8),
        age: tx.time ? Math.max(0, Math.floor(Date.now() / 1000 - tx.time)) : 'N/A',
        isCoinbase: vin.length === 1 && vin[0].coinbase,
      },
      vin,
      vout,
    });
  } catch (err) {
    res.status(404).render('error', { error: 'Transaction not found: ' + err.message, coin: config.coin, active: 'tx' });
  }
});

// 4. Address Details (/address/:hash) - High Speed Indexed Lookup with Pagination
router.get('/address/:hash', async (req, res) => {
  try {
    const address = (req.params.hash || '').trim();

    // Universal address validation (26 to 90 alphanumeric characters)
    const isValidAddress = /^[a-zA-Z0-9]{26,90}$/.test(address);
    if (!isValidAddress) {
      return res.status(404).render('error', {
        error: `Invalid wallet address: "${address}". Please verify the address format and try again.`,
        coin: config.coin,
        active: 'address',
      });
    }

    const claim = claimsService.getClaim(address);

    let balance = '0.00000000';
    let received = '0.00000000';
    let sent = '0.00000000';

    // 1. Direct native RPC balance (<10ms)
    try {
      const balData = await rpc.getAddressBalance(address);
      if (balData && typeof balData.balance === 'number') {
        const balCoins = balData.balance / 1e8;
        const recCoins = (balData.received || 0) / 1e8;
        const sentCoins = Math.max(0, recCoins - balCoins);

        balance = balCoins.toFixed(8);
        received = recCoins.toFixed(8);
        sent = sentCoins.toFixed(8);

        db.saveAddressBalance(address, balCoins, recCoins, sentCoins, 0);
      }
    } catch (e) {
      // fallback to SQLite cache
      const dbAddr = db.getAddress(address);
      if (dbAddr) {
        balance = (dbAddr.balance || 0).toFixed(8);
        received = (dbAddr.received || 0).toFixed(8);
        sent = (dbAddr.sent || 0).toFixed(8);
      }
    }

    // 2. High-speed SQLite pagination (20 per page)
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = 20;
    const offset = (page - 1) * limit;

    const dbTxs = db.getAddressTransactions(address, limit, offset);
    let totalTxs = db.getAddressTransactionCount(address);
    const dbAddr = db.getAddress(address);
    if (dbAddr && dbAddr.tx_count > totalTxs) {
      totalTxs = dbAddr.tx_count;
    }
    const totalPages = Math.max(1, Math.ceil(totalTxs / limit));

    const txs = (dbTxs || []).map(t => ({
      txid: t.txid,
      height: t.blockheight,
      type: t.type || 'RECEIVED',
      amount: (t.amount || 0).toFixed(8),
      time: t.time,
      age: Math.max(0, Math.floor(Date.now() / 1000 - t.time)),
      formattedAge: formatAge(t.time),
    }));

    res.render('address', {
      active: 'address',
      coin: config.coin,
      address,
      balance,
      received,
      sent,
      txCount: totalTxs.toLocaleString(),
      claim: claim ? claim.claim_name : null,
      txs,
      pagination: {
        page,
        limit,
        totalPages,
        totalTxs,
      },
    });
  } catch (err) {
    res.status(500).render('error', { error: 'Address lookup error: ' + err.message, coin: config.coin, active: 'address' });
  }
});

// 5. Masternodes (/masternodes)
router.get('/masternodes', async (req, res) => {
  const conf = config.getConfig();
  if (conf.features && conf.features.hasMasternodes === false) {
    return res.redirect('/');
  }
  try {
    const [mnCount, rawList] = await Promise.all([
      rpc.getMasternodeCount().catch(() => ({ total: 0, enabled: 0 })),
      rpc.getMasternodeList('full').catch(() => ({})),
    ]);

    const allClaims = claimsService.getAllClaims();
    const claimMap = new Map(allClaims.map(c => [c.address, c.claim_name]));

    const masternodes = [];
    let rank = 1;
    if (rawList && typeof rawList === 'object') {
      for (const [key, value] of Object.entries(rawList)) {
        const parts = typeof value === 'string' ? value.trim().split(/\s+/) : [];
        const status = parts[0] || 'ENABLED';
        const linkedWallet = parts[1] || '';
        const lastseen = parseInt(parts[2] || '0', 10);
        const activeblocks = parseInt(parts[3] || '0', 10);
        const ip = parts[4] || parts[parts.length - 1] || 'Unknown';

        masternodes.push({
          rank: rank++,
          txhash: key,
          status,
          wallet: linkedWallet,
          claim: claimMap.get(linkedWallet) || null,
          lastseen: lastseen > 0 ? formatTime(lastseen) : 'N/A',
          activeblocks,
          ip,
        });
      }
    }

    res.render('masternodes', {
      active: 'masternodes',
      coin: config.coin,
      counts: {
        total: mnCount.total || masternodes.length,
        enabled: mnCount.enabled || masternodes.filter(m => m.status === 'ENABLED').length,
        lockedSupply: (masternodes.length * 10000).toLocaleString(),
      },
      masternodes,
    });
  } catch (err) {
    res.status(500).render('error', { error: err.message, coin: config.coin, active: 'masternodes' });
  }
});

// 6. Network Peers (/network)
router.get('/network', async (req, res) => {
  try {
    const peers = await rpc.getPeerInfo();
    const formattedPeers = peers.map(p => ({
      addr: p.addr,
      subver: p.subver ? p.subver.replace(/\//g, '') : 'Gspcoin Core',
      version: p.version,
      ping: p.pingtime ? (p.pingtime * 1000).toFixed(0) + ' ms' : 'N/A',
      conntime: formatTime(p.conntime),
      inbound: p.inbound ? 'Inbound' : 'Outbound',
    }));

    res.render('network', {
      active: 'network',
      coin: config.coin,
      peers: formattedPeers,
      count: formattedPeers.length,
    });
  } catch (err) {
    res.status(500).render('error', { error: err.message, coin: config.coin, active: 'network' });
  }
});

// 7. Rich List & Distribution (/richlist) - 100% Real Data matching actual explorer
router.get('/richlist', async (req, res) => {
  try {
    const data = await richlistService.fetchRealRichlist();
    const allClaims = claimsService.getAllClaims();
    const claimMap = new Map(allClaims.map(c => [c.address, c.claim_name]));

    const list = (data.richlist && data.richlist.length > 0) ? data.richlist : (data.top100 || []);
    const richlistWithClaims = list.map(r => ({
      ...r,
      claim: claimMap.get(r.address) || null,
    }));

    // Fetch Top 100 largest movements (> 1M GSPC) ranked high to low
    const rawMovements = db.getLargeTransactions(1000000, 100);
    const topMovements = (rawMovements || []).map(t => ({
      txid: t.txid,
      blockHeight: t.blockheight,
      rawAmount: t.total_out || 0,
      amount: Number(t.total_out || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 }),
      time: t.time,
      age: Math.max(0, Math.floor(Date.now() / 1000 - t.time)),
      formattedAge: formatAge(t.time),
    }));

    res.render('richlist', {
      active: 'richlist',
      coin: config.coin,
      supply: data.supply,
      rawSupply: data.rawSupply,
      tiers: data.tiers,
      totalTop100: data.totalTop100,
      richlist: richlistWithClaims,
      topMovements,
    });
  } catch (err) {
    res.status(500).render('error', { error: err.message, coin: config.coin, active: 'richlist' });
  }
});

// 8. Movement (/movement) - Top 100 Largest Movements ranked High to Low
router.get('/movement', async (req, res) => {
  try {
    let rawMovements = db.getLargeTransactions(1000000, 100);
    if (!rawMovements || rawMovements.length < 100) {
      rawMovements = db.getTop100Transactions(100);
    }
    const txs = (rawMovements || []).map(t => ({
      txid: t.txid,
      blockHeight: t.blockheight,
      rawAmount: t.total_out || 0,
      amount: Number(t.total_out || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 }),
      time: t.time,
      age: Math.max(0, Math.floor(Date.now() / 1000 - t.time)),
      formattedAge: formatAge(t.time),
    }));

    res.render('movement', {
      active: 'movement',
      coin: config.coin,
      txs,
    });
  } catch (err) {
    res.status(500).render('error', { error: err.message, coin: config.coin, active: 'movement' });
  }
});

// 9. Claim Address (/claim)
router.get('/claim', (req, res) => {
  const claims = claimsService.getAllClaims();
  res.render('claim', {
    active: 'claim',
    coin: config.coin,
    claims: claims.map(c => ({
      ...c,
      formattedDate: formatTime(c.claimed_at),
    })),
    success: req.query.success || null,
    error: req.query.error || null,
  });
});

router.post('/claim', async (req, res) => {
  try {
    const { address, claim_name, message, signature } = req.body;
    if (!address || !claim_name || !message || !signature) {
      return res.redirect('/claim?error=All+fields+are+required');
    }

    const isValid = await rpc.verifyMessage(address.trim(), signature.trim(), message.trim());
    if (!isValid) {
      return res.redirect('/claim?error=Invalid+signature.+Please+verify+message+and+signature+in+your+wallet.');
    }

    claimsService.addClaim(address.trim(), claim_name.trim(), message.trim(), signature.trim());
    res.redirect('/claim?success=Address+ownership+successfully+verified+and+claimed!');
  } catch (err) {
    res.redirect('/claim?error=' + encodeURIComponent(err.message));
  }
});

// 10. Orphaned Blocks (/orphans) - Direct Node Consensus from getchaintips RPC
router.get('/orphans', async (req, res) => {
  try {
    const tips = (await rpc.getChainTips()) || [];
    const activeTip = tips.find(t => t.status === 'active') || tips[0];
    const orphans = tips.filter(t => t.status !== 'active').map(t => ({
      height: t.height,
      hash: t.hash,
      status: t.status,
      branchlen: t.branchlen,
      forkpoint: t.forkpoint || 'N/A',
      difficulty: typeof t.difficulty === 'number' ? t.difficulty.toFixed(6) : t.difficulty,
    }));

    const allTips = tips.map(t => ({
      height: t.height,
      hash: t.hash,
      status: t.status,
      branchlen: t.branchlen,
      forkpoint: t.forkpoint || 'N/A',
      difficulty: typeof t.difficulty === 'number' ? t.difficulty.toFixed(6) : t.difficulty,
    }));

    res.render('orphans', {
      active: 'orphans',
      coin: config.coin,
      activeHeight: activeTip ? activeTip.height : 0,
      activeHash: activeTip ? activeTip.hash : 'N/A',
      orphans,
      allTips,
    });
  } catch (err) {
    res.status(500).render('error', { error: 'Orphan lookup error: ' + err.message, coin: config.coin, active: 'orphans' });
  }
});

// 11. Market (/market) - Clean display only, no public config
router.get('/market', async (req, res) => {
  try {
    const [priceData, exchanges, height] = await Promise.all([
      market.fetchPrice(),
      market.getExchangesList(),
      rpc.getBlockCount().catch(() => 0),
    ]);

    const supply = calculateMoneySupply(height);
    const priceUsd = parseFloat(priceData.last_price_usd || 0);
    const marketCap = (priceUsd * supply).toLocaleString(undefined, { maximumFractionDigits: 2 });

    let total24hVol = 0;
    for (const ex of exchanges) {
      total24hVol += parseFloat(ex.volume_24h || 0);
    }

    res.render('market', {
      active: 'market',
      coin: config.coin,
      price: priceData,
      exchanges,
      marketCap,
      total24hVol: total24hVol.toLocaleString(undefined, { maximumFractionDigits: 2 }),
      supply: supply.toLocaleString(undefined, { maximumFractionDigits: 2 }),
    });
  } catch (err) {
    res.status(500).render('error', { error: 'Market error: ' + err.message, coin: config.coin, active: 'market' });
  }
});

// 12. Chart API Data (/api/charts) - Pure SQLite Real Data with configurable timeframe
router.get('/api/charts', async (req, res) => {
  try {
    const conf = config.getConfig();
    const defaultDays = (conf.chart && conf.chart.defaultDays) || 30;
    const requestedDays = parseInt(req.query.days, 10);
    const days = (!isNaN(requestedDays) && requestedDays >= 5 && requestedDays <= 90) ? requestedDays : defaultDays;

    const dbDaily = db.getDailyChartStats(days) || [];
    const dbMap = new Map();
    for (const item of dbDaily) {
      dbMap.set(item.day, item);
    }

    // Build contiguous calendar sequence for the requested timeframe
    const history = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000);
      const dayStr = d.toISOString().slice(0, 10);
      const record = dbMap.get(dayStr);

      if (record) {
        const diff = record.avg_difficulty ? parseFloat(record.avg_difficulty.toFixed(6)) : 0;
        const hashrate = parseFloat(((diff * Math.pow(2, 32)) / (150 * 1e6)).toFixed(4));
        history.push({
          day: dayStr,
          block_count: record.block_count || 0,
          tx_count: record.tx_count || 0,
          avg_difficulty: diff,
          avg_hashrate: hashrate,
        });
      } else {
        history.push({
          day: dayStr,
          block_count: 0,
          tx_count: 0,
          avg_difficulty: 0,
          avg_hashrate: 0,
        });
      }
    }

    res.json({ success: true, days, history });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 13. API Info (/info)
router.get('/info', async (req, res) => {
  const conf = config.getConfig();
  let rawDomain = conf.domain;
  if (rawDomain && rawDomain.trim().length > 0) {
    rawDomain = rawDomain.trim();
    if (!rawDomain.startsWith('http://') && !rawDomain.startsWith('https://')) {
      rawDomain = `${req.protocol}://${rawDomain}`;
    }
  } else {
    rawDomain = `${req.protocol}://${req.get('host') || ('localhost:' + conf.port)}`;
  }
  const sampleAddr = (db.getTopAddresses(1)[0]?.address) || 'WALLET_ADDRESS';
  const sampleTx = (db.getRecentTransactions(1)[0]?.txid) || 'TRANSACTION_ID';
  const sampleBlk = (db.getRecentBlocks(1)[0]?.hash) || 'BLOCK_HASH';

  res.render('info', {
    active: 'info',
    coin: conf.coin,
    host: rawDomain,
    domain: rawDomain,
    protocol: req.protocol,
    sampleAddr,
    sampleTx,
    sampleBlk,
  });
});

// 14. QR Code generator (/qr/:hash)
router.get('/qr/:hash', async (req, res) => {
  try {
    const hash = req.params.hash;
    const svg = await QRCode.toString(hash, {
      type: 'svg',
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
      margin: 1,
      width: 250,
    });
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(svg);
  } catch (err) {
    res.status(500).send('Error generating QR code');
  }
});

// 15. Multi-Target Search (/search)
router.all('/search', async (req, res) => {
  const query = (req.body.search || req.query.q || '').trim();
  if (!query) {
    return res.redirect('/');
  }

  // 1. Integer -> Block height
  if (/^\d+$/.test(query)) {
    const height = parseInt(query, 10);
    const tip = await rpc.getBlockCount().catch(() => 0);
    if (height <= tip) {
      return res.redirect(`/block/${height}`);
    }
    return res.status(404).render('error', {
      error: `Block height #${height} does not exist. Current network block height is #${tip.toLocaleString()}.`,
      coin: config.coin,
      active: 'search',
    });
  }

  // 2. 64-char hex -> Block hash or Transaction ID
  if (/^[a-fA-F0-9]{64}$/.test(query)) {
    try {
      const block = await rpc.getBlock(query, 1).catch(() => null);
      if (block) {
        return res.redirect(`/block/${query}`);
      }
      const tx = await rpc.getRawTransaction(query, 1).catch(() => null);
      if (tx) {
        return res.redirect(`/tx/${query}`);
      }
      return res.status(404).render('error', {
        error: `No block or transaction found with hash: "${query}"`,
        coin: config.coin,
        active: 'search',
      });
    } catch {
      return res.status(404).render('error', {
        error: `No block or transaction found with hash: "${query}"`,
        coin: config.coin,
        active: 'search',
      });
    }
  }

  // 3. Address validation: General crypto address format (26 to 90 alphanumeric characters)
  if (/^[a-zA-Z0-9]{26,90}$/.test(query)) {
    return res.redirect(`/address/${query}`);
  }

  // Invalid query format
  res.status(404).render('error', {
    error: `Invalid search query: "${query}". Please enter a valid block height, transaction hash, or wallet address.`,
    coin: config.coin,
    active: 'search',
  });
});

module.exports = router;
