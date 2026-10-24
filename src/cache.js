const { LRUCache } = require('lru-cache');

// Blocks are immutable once deeply confirmed
const blockCache = new LRUCache({
  max: 5000, // cache up to 5000 recent blocks
  ttl: 1000 * 60 * 60 * 24, // 24 hours
});

// Transactions are immutable
const txCache = new LRUCache({
  max: 20000,
  ttl: 1000 * 60 * 60 * 24,
});

// Address balances and transactions
const addressCache = new LRUCache({
  max: 2000,
  ttl: 1000 * 15, // 15 seconds
});

// General dynamic stats cache (summary, peers, price, etc.)
const dynamicCache = new LRUCache({
  max: 100,
  ttl: 1000 * 10, // 10 seconds default
});

module.exports = {
  blockCache,
  txCache,
  addressCache,
  dynamicCache,
};
