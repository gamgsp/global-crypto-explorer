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

  // Real-time verification of top balances via native daemon addressindex
  try {
    const currentTop = db.getTopAddresses(120);
    if (currentTop && currentTop.length > 0) {
      const chunkSize = 20;
      for (let i = 0; i < currentTop.length; i += chunkSize) {
        const chunk = currentTop.slice(i, i + chunkSize);
        await Promise.all(chunk.map(async (row) => {
          try {
            const balData = await rpc.call('getaddressbalance', [{ addresses: [row.address] }]);
            if (balData && typeof balData.balance === 'number') {
              const bal = balData.balance / 1e8;
              const rec = (balData.received || balData.balance) / 1e8;
              db.saveAddressBalance(row.address, bal, rec, Math.max(0, rec - bal), 0);
            }
          } catch (e) {}
        }));
      }
    }
  } catch (err) {}

  return db.getRichlistTiers(supply);
}

function getBalanceFromRichlist(address) {
  const row = db.getAddress(address);
  return row ? row.balance : null;
}

module.exports = {
  fetchRealRichlist: getRichlistData,
  getRichlistData,
  getBalanceFromRichlist,
  recalculate: getRichlistData,
};
