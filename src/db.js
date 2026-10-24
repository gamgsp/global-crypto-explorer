const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'explorer.db');
const db = new Database(DB_PATH);

// High-performance, low-memory WAL settings
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -16000'); // 16 MB RAM limit
db.pragma('temp_store = MEMORY');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS blocks (
    height INTEGER PRIMARY KEY,
    hash TEXT UNIQUE,
    time INTEGER,
    tx_count INTEGER,
    size INTEGER,
    difficulty REAL
  );

  CREATE TABLE IF NOT EXISTS txs (
    txid TEXT PRIMARY KEY,
    blockheight INTEGER,
    blockhash TEXT,
    time INTEGER,
    total_out REAL,
    vin_count INTEGER,
    vout_count INTEGER
  );

  CREATE TABLE IF NOT EXISTS addresses (
    address TEXT PRIMARY KEY,
    balance REAL DEFAULT 0,
    received REAL DEFAULT 0,
    sent REAL DEFAULT 0,
    tx_count INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS address_txs (
    address TEXT,
    txid TEXT,
    blockheight INTEGER,
    amount REAL,
    type TEXT,
    time INTEGER,
    PRIMARY KEY (address, txid, type)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_blocks_height ON blocks(height DESC);
  CREATE INDEX IF NOT EXISTS idx_txs_height ON txs(blockheight DESC);
  CREATE INDEX IF NOT EXISTS idx_addresses_bal ON addresses(balance DESC);
  CREATE INDEX IF NOT EXISTS idx_addr_txs_lookup ON address_txs(address, blockheight DESC);
`);

// Prepared statements
const stmts = {
  // Settings
  getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
  setSetting: db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'),
  getAllSettings: db.prepare('SELECT key, value FROM settings'),

  // Blocks
  insertBlock: db.prepare(`
    INSERT OR REPLACE INTO blocks (height, hash, time, tx_count, size, difficulty)
    VALUES (@height, @hash, @time, @tx_count, @size, @difficulty)
  `),
  getRecentBlocks: db.prepare('SELECT * FROM blocks ORDER BY height DESC LIMIT ? OFFSET ?'),
  getBlockCount: db.prepare('SELECT COUNT(*) as count FROM blocks'),
  getMaxBlockHeight: db.prepare('SELECT MAX(height) as max_height FROM blocks'),
  getBlockByHeight: db.prepare('SELECT * FROM blocks WHERE height = ?'),
  getBlockByHash: db.prepare('SELECT * FROM blocks WHERE hash = ?'),

  // Txs
  insertTx: db.prepare(`
    INSERT OR REPLACE INTO txs (txid, blockheight, blockhash, time, total_out, vin_count, vout_count)
    VALUES (@txid, @blockheight, @blockhash, @time, @total_out, @vin_count, @vout_count)
  `),
  getRecentTxs: db.prepare('SELECT * FROM txs ORDER BY blockheight DESC LIMIT ? OFFSET ?'),
  getTxCount: db.prepare('SELECT COUNT(*) as count FROM txs'),
  getTxById: db.prepare('SELECT * FROM txs WHERE txid = ?'),
  getLargeTxs: db.prepare('SELECT * FROM txs WHERE total_out >= ? ORDER BY total_out DESC LIMIT ?'),
  getTop100Txs: db.prepare('SELECT * FROM txs ORDER BY total_out DESC LIMIT ?'),

  // Addresses
  upsertAddress: db.prepare(`
    INSERT INTO addresses (address, balance, received, sent, tx_count)
    VALUES (@address, @balance, @received, @sent, @tx_count)
    ON CONFLICT(address) DO UPDATE SET
      balance = @balance,
      received = MAX(addresses.received, @received),
      sent = MAX(addresses.sent, @sent),
      tx_count = addresses.tx_count + @tx_count
  `),
  insertAddressTx: db.prepare(`
    INSERT OR REPLACE INTO address_txs (address, txid, blockheight, amount, type, time)
    VALUES (@address, @txid, @blockheight, @amount, @type, @time)
  `),
  getAddress: db.prepare('SELECT * FROM addresses WHERE address = ?'),
  getAddressTxs: db.prepare('SELECT DISTINCT txid, blockheight, amount, type, time FROM address_txs WHERE address = ? ORDER BY blockheight DESC LIMIT ? OFFSET ?'),
  getAddressTxCount: db.prepare('SELECT COUNT(DISTINCT txid) as count FROM address_txs WHERE address = ?'),
  getTopAddresses: db.prepare('SELECT * FROM addresses WHERE balance > 0 ORDER BY balance DESC LIMIT ?'),

  // Analytics
  getDailyChartStats: db.prepare(`
    SELECT day, block_count, tx_count, avg_difficulty
    FROM (
      SELECT date(time, 'unixepoch') as day, COUNT(*) as block_count, SUM(tx_count) as tx_count, AVG(difficulty) as avg_difficulty
      FROM blocks
      GROUP BY day
      ORDER BY day DESC
      LIMIT ?
    )
    ORDER BY day ASC
  `),
};

// Batch inserters
const insertBlockBatch = db.transaction((blocksList) => {
  for (const b of blocksList) {
    stmts.insertBlock.run(b);
  }
});

const insertTxBatch = db.transaction((txList) => {
  for (const t of txList) {
    stmts.insertTx.run(t);
  }
});

const saveSettingsBatch = db.transaction((entries) => {
  for (const [k, v] of Object.entries(entries)) {
    stmts.setSetting.run(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
});

module.exports = {
  db,
  stmts,
  insertBlockBatch,
  insertTxBatch,

  // Settings API
  getSetting(key, defaultValue = null) {
    const row = stmts.getSetting.get(key);
    return row !== undefined ? row.value : defaultValue;
  },
  setSetting(key, value) {
    stmts.setSetting.run(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
  },
  getAllSettings() {
    const rows = stmts.getAllSettings.all();
    const map = {};
    for (const r of rows) {
      map[r.key] = r.value;
    }
    return map;
  },
  updateSettings(obj) {
    saveSettingsBatch(obj);
  },
  isConfigured() {
    const configured = stmts.getSetting.get('is_configured');
    const pwd = stmts.getSetting.get('admin_password_hash');
    return !!(configured && configured.value === '1' && pwd && pwd.value && pwd.value.length > 0);
  },

  // Blocks API
  getRecentBlocks(limit = 20, offset = 0) {
    return stmts.getRecentBlocks.all(limit, offset);
  },
  getBlockCount() {
    const res = stmts.getBlockCount.get();
    return res ? res.count : 0;
  },
  getMaxBlockHeight() {
    const res = stmts.getMaxBlockHeight.get();
    return res && res.max_height !== null ? res.max_height : 0;
  },
  getBlock(heightOrHash) {
    if (typeof heightOrHash === 'number' || (!isNaN(heightOrHash) && String(heightOrHash).length < 10)) {
      return stmts.getBlockByHeight.get(parseInt(heightOrHash, 10));
    }
    return stmts.getBlockByHash.get(heightOrHash);
  },

  // Transactions API
  getRecentTransactions(limit = 20, offset = 0) {
    return stmts.getRecentTxs.all(limit, offset);
  },
  getTransactionCount() {
    const res = stmts.getTxCount.get();
    return res ? res.count : 0;
  },
  getTransaction(txid) {
    return stmts.getTxById.get(txid);
  },
  getLargeTransactions(minAmount = 1000000, limit = 100) {
    let rows = stmts.getLargeTxs.all(minAmount, limit);
    if (!rows || rows.length === 0) {
      rows = stmts.getTop100Txs.all(limit);
    }
    return rows || [];
  },
  getTop100Transactions(limit = 100) {
    return stmts.getTop100Txs.all(limit);
  },

  // Addresses & Richlist API
  getAddress(address) {
    return stmts.getAddress.get(address);
  },
  getAddressTransactions(address, limit = 50, offset = 0) {
    return stmts.getAddressTxs.all(address, limit, offset);
  },
  getAddressTransactionCount(address) {
    const res = stmts.getAddressTxCount.get(address);
    return res ? res.count : 0;
  },
  getTopAddresses(limit = 100) {
    return stmts.getTopAddresses.all(limit);
  },
  getRichlistTiers(circulatingSupply = 0) {
    const top100 = stmts.getTopAddresses.all(100);
    let t1 = 0, t2 = 0, t3 = 0, t4 = 0;
    const list = [];

    for (let i = 0; i < top100.length; i++) {
      const rank = i + 1;
      const item = top100[i];
      const bal = item.balance || 0;

      if (rank <= 25) t1 += bal;
      else if (rank <= 50) t2 += bal;
      else if (rank <= 75) t3 += bal;
      else if (rank <= 100) t4 += bal;

      const percent = circulatingSupply > 0 ? ((bal / circulatingSupply) * 100).toFixed(2) : '0.00';
      list.push({
        rank,
        address: item.address,
        balance: bal.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 8 }),
        balanceRaw: bal,
        percent,
        percentRaw: parseFloat(percent) || 0,
        received: (item.received || bal).toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 8 }),
        receivedRaw: (item.received || bal),
      });
    }

    const totalTop100 = t1 + t2 + t3 + t4;
    const rest = Math.max(0, circulatingSupply - totalTop100);

    return {
      top100: list,
      richlist: list,
      totalTop100: totalTop100.toLocaleString(undefined, { maximumFractionDigits: 2 }),
      supply: circulatingSupply.toLocaleString(undefined, { maximumFractionDigits: 2 }),
      rawSupply: circulatingSupply,
      tiers: {
        top1_25: {
          percent: circulatingSupply > 0 ? ((t1 / circulatingSupply) * 100).toFixed(2) : '0.00',
          amount: t1.toLocaleString(undefined, { maximumFractionDigits: 2 }),
        },
        top26_50: {
          percent: circulatingSupply > 0 ? ((t2 / circulatingSupply) * 100).toFixed(2) : '0.00',
          amount: t2.toLocaleString(undefined, { maximumFractionDigits: 2 }),
        },
        top51_75: {
          percent: circulatingSupply > 0 ? ((t3 / circulatingSupply) * 100).toFixed(2) : '0.00',
          amount: t3.toLocaleString(undefined, { maximumFractionDigits: 2 }),
        },
        top76_100: {
          percent: circulatingSupply > 0 ? ((t4 / circulatingSupply) * 100).toFixed(2) : '0.00',
          amount: t4.toLocaleString(undefined, { maximumFractionDigits: 2 }),
        },
        rest: {
          percent: circulatingSupply > 0 ? ((rest / circulatingSupply) * 100).toFixed(2) : '0.00',
          amount: rest.toLocaleString(undefined, { maximumFractionDigits: 2 }),
        },
      },
    };
  },
  saveAddressBalance(address, balance, received = 0, sent = 0, txIncrement = 1) {
    stmts.upsertAddress.run({
      address,
      balance,
      received: received || balance,
      sent,
      tx_count: txIncrement,
    });
  },
  recordAddressTx(address, txid, blockheight, amount, type, time) {
    stmts.insertAddressTx.run({
      address,
      txid,
      blockheight,
      amount,
      type,
      time,
    });
  },

  // Daily Chart Stats API (Pure SQLite)
  getDailyChartStats(limit = 30) {
    return stmts.getDailyChartStats.all(Number(limit) || 30);
  },
};
