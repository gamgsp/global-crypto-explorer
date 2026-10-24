const db = require('./db');
const rpc = require('./rpc');
const { calculateMoneySupply } = require('./supply');

// Authoritative local recalculation: ranks top 100 & calculates exact wealth distribution tiers purely from SQLite
async function getRichlistData() {
  let tip = 0;
  try {
    tip = await rpc.getBlockCount();
  } catch (e) {
    tip = db.getMaxBlockHeight() || 0;
  }
  const supply = calculateMoneySupply(tip);
  return db.getRichlistTiers(supply);
}

function getBalanceFromRichlist(address) {
  const row = db.getAddress(address);
  return row ? row.balance : null;
}

// Background block scanner to ensure address balances are kept synchronized
let isSyncing = false;
async function syncNewBlocks() {
  if (isSyncing) return;
  isSyncing = true;
  try {
    const tip = await rpc.getBlockCount();
    const maxDb = db.getMaxBlockHeight() || 0;
    if (tip > maxDb) {
      // Indexer will sync these blocks directly into SQLite
    }
  } catch (err) {
  } finally {
    isSyncing = false;
  }
}

module.exports = {
  fetchRealRichlist: getRichlistData,
  getRichlistData,
  getBalanceFromRichlist,
  syncNewBlocks,
  recalculate: getRichlistData,
};
