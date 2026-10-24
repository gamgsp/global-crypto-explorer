const { dynamicCache } = require('./cache');
const config = require('./config');

let lastKnownPrice = {
  last_price_usd: '0.00',
  last_price_usdt: '0.00',
  last_price_btc: '0.00000000',
  source: 'N/A',
  last_updated: Date.now(),
};

function getExchangesList() {
  const conf = config.getConfig();
  return conf.exchanges || [];
}

async function fetchPrice() {
  const cached = dynamicCache.get('market_price');
  if (cached) return cached;

  const exchanges = getExchangesList();
  if (!exchanges || exchanges.length === 0) {
    return lastKnownPrice;
  }

  let latestUsd = 0;
  let source = 'N/A';

  for (const ex of exchanges) {
    if (ex.active === false || !ex.ticker_url) continue;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);

      const res = await fetch(ex.ticker_url, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json', 'User-Agent': 'GlobalCryptoExplorer/2.0' },
      });
      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json();
        let price = 0;
        let volume = 0;

        if (ex.ticker_url.includes('coinpaprika')) {
          price = parseFloat(data.quotes?.USD?.price || 0);
          volume = parseFloat(data.quotes?.USD?.volume_24h || 0);
        } else if (ex.ticker_url.includes('xeggex')) {
          price = parseFloat(data.lastPrice || 0);
          volume = parseFloat(data.volumeUsd || data.volume || 0);
        } else if (data.price) {
          price = parseFloat(data.price);
          volume = parseFloat(data.volume || 0);
        } else if (data.data?.price) {
          price = parseFloat(data.data.price);
          volume = parseFloat(data.data.volume || 0);
        }

        if (price > 0) {
          ex.last_price = price;
          ex.volume_24h = volume;
          if (!latestUsd) {
            latestUsd = price;
            source = ex.name;
          }
        }
      }
    } catch (err) {}
  }

  if (latestUsd > 0) {
    const btcEstimate = (latestUsd / 65000).toFixed(8);
    lastKnownPrice = {
      last_price_usd: latestUsd.toFixed(8),
      last_price_usdt: latestUsd.toFixed(8),
      last_price_btc: btcEstimate,
      source,
      last_updated: Date.now(),
    };
    dynamicCache.set('market_price', lastKnownPrice, { ttl: 60000 });
  }

  return lastKnownPrice;
}

module.exports = {
  fetchPrice,
  getExchangesList,
};
