const { dynamicCache } = require('./cache');
const config = require('./config');

let lastKnownPrice = {
  last_price_usd: '0.00',
  last_price_usdt: '0.00',
  last_price_btc: '0.00000000',
  source: 'N/A',
  last_updated: Date.now(),
};

// Map of exchange key -> { price: Number, volume: Number, last_updated: Number }
const exchangeLiveStats = new Map();

let cachedBtcUsd = 0;
let lastBtcFetch = 0;

/**
 * Robust live BTC/USD rate fetcher with 5-minute memory cache
 */
async function getBtcUsdRate() {
  if (cachedBtcUsd > 0 && Date.now() - lastBtcFetch < 300000) {
    return cachedBtcUsd;
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT', {
      signal: controller.signal,
      headers: { 'Accept': 'application/json', 'User-Agent': 'GlobalCryptoExplorer/2.0' },
    });
    clearTimeout(timeout);
    if (res.ok) {
      const btcData = await res.json();
      const p = parseFloat(btcData.price);
      if (!isNaN(p) && p > 0) {
        cachedBtcUsd = p;
        lastBtcFetch = Date.now();
        return p;
      }
    }
  } catch (e) {}

  return cachedBtcUsd > 0 ? cachedBtcUsd : 85000;
}

/**
 * Universal crypto exchange ticker parser
 * Extracts price and volume from any standard format:
 * - GSPC Exchange ({ ticker_id, last_price, base_volume, target_volume, ... })
 * - CoinGecko / Coinpaprika ({ quotes: { USD: { price, volume_24h } } })
 * - Xeggex ({ lastPrice, volumeUsd, volume })
 * - Binance ({ lastPrice, quoteVolume, volume })
 * - Arrays of tickers ([ { ticker_id, last_price, ... } ])
 * - Generic tickers ({ price, lastPrice, last_price, last, close, rate, data: { ... } })
 */
function extractPriceAndVolume(raw, pairName = '') {
  if (!raw) return { price: 0, volume: 0 };
  let d = raw;

  // Handle arrays of ticker objects
  if (Array.isArray(d)) {
    if (d.length === 0) return { price: 0, volume: 0 };
    if (pairName) {
      const cleanPair = pairName.toUpperCase().replace(/[\/\-_()]/g, '');
      const match = d.find((item) => {
        if (!item || typeof item !== 'object') return false;
        const id = (item.ticker_id || item.symbol || item.pair || item.market || item.trading_pairs || '')
          .toUpperCase()
          .replace(/[\/\-_()]/g, '');
        return id.includes(cleanPair) || cleanPair.includes(id);
      });
      d = match || d[0];
    } else {
      d = d[0];
    }
  }

  // Handle nested wrappers
  if (d && typeof d === 'object') {
    if (d.data && typeof d.data === 'object' && !d.price && !d.last_price && !d.lastPrice) {
      d = Array.isArray(d.data) ? d.data[0] : d.data;
    } else if (d.result && typeof d.result === 'object' && !d.price && !d.last_price && !d.lastPrice) {
      d = Array.isArray(d.result) ? d.result[0] : d.result;
    } else if (d.ticker && typeof d.ticker === 'object' && !d.price && !d.last_price && !d.lastPrice) {
      d = d.ticker;
    }
  }

  if (!d || typeof d !== 'object') return { price: 0, volume: 0 };

  // 1. Coinpaprika structure
  if (d.quotes && d.quotes.USD) {
    const p = parseFloat(d.quotes.USD.price || 0);
    const v = parseFloat(d.quotes.USD.volume_24h || 0);
    return { price: isNaN(p) ? 0 : p, volume: isNaN(v) ? 0 : v };
  }

  // 2. Comprehensive price resolution
  const priceCandidates = [
    d.last_price,
    d.lastPrice,
    d.price,
    d.last,
    d.close,
    d.rate,
    d.c,
    d.priceUsd,
    d.price_usd,
    d.ask,
  ];

  let price = 0;
  for (const c of priceCandidates) {
    if (c !== undefined && c !== null && c !== '') {
      const num = parseFloat(c);
      if (!isNaN(num) && num > 0) {
        price = num;
        break;
      }
    }
  }

  // 3. Comprehensive volume resolution (prefer USD/quote currency volume)
  const volumeCandidates = [
    d.target_volume,
    d.quote_volume,
    d.quoteVolume,
    d.volumeUsd,
    d.volume_usd,
    d.volume_24h,
    d.volume,
    d.vol,
    d.base_volume,
    d.baseVolume,
  ];

  let volume = 0;
  for (const v of volumeCandidates) {
    if (v !== undefined && v !== null && v !== '') {
      const num = parseFloat(v);
      if (!isNaN(num) && num > 0) {
        volume = num;
        break;
      }
    }
  }

  // If only base token volume was reported, calculate USD equivalent volume
  if (d.base_volume && !d.target_volume && !d.quote_volume && !d.volumeUsd && price > 0) {
    const baseVol = parseFloat(d.base_volume);
    if (!isNaN(baseVol) && baseVol > 0) {
      volume = baseVol * price;
    }
  }

  return { price, volume };
}

/**
 * Returns raw exchange configs from settings
 */
function getRawExchanges() {
  const conf = config.getConfig();
  return conf.exchanges || [];
}

/**
 * Fetches and aggregates market data across all configured exchanges
 */
async function getMarketData() {
  const cached = dynamicCache.get('market_full_data');
  if (cached) return cached;

  const rawExchanges = getRawExchanges();
  if (!rawExchanges || rawExchanges.length === 0) {
    return {
      price: lastKnownPrice,
      exchanges: [],
    };
  }

  const populatedExchanges = [];
  let latestUsd = 0;
  let source = 'N/A';

  // Process all exchanges in parallel
  await Promise.all(
    rawExchanges.map(async (ex, index) => {
      const exchangeKey = ex.id || `${ex.name || 'ex'}_${ex.pair || index}`;
      const item = {
        ...ex,
        last_price: 0,
        volume_24h: 0,
      };

      // Restore last known good values from memory if available
      const existing = exchangeLiveStats.get(exchangeKey);
      if (existing) {
        item.last_price = existing.price;
        item.volume_24h = existing.volume;
      }

      if (ex.active !== false && ex.ticker_url && ex.ticker_url.trim().length > 0) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 4500);

          const res = await fetch(ex.ticker_url.trim(), {
            signal: controller.signal,
            headers: {
              'Accept': 'application/json',
              'User-Agent': 'GlobalCryptoExplorer/2.0',
            },
          });
          clearTimeout(timeout);

          if (res.ok) {
            const json = await res.json();
            const { price, volume } = extractPriceAndVolume(json, ex.pair || '');

            if (price > 0) {
              item.last_price = price;
              item.volume_24h = volume;
              exchangeLiveStats.set(exchangeKey, { price, volume, last_updated: Date.now() });

              if (!latestUsd) {
                latestUsd = price;
                source = ex.name || 'GSPC Exchange';
              }
            }
          }
        } catch (err) {
          // Keep last known values on temporary network failure
        }
      }

      populatedExchanges.push(item);
    })
  );

  // If no new price was fetched in this cycle, use the best available from memory
  if (!latestUsd) {
    for (const item of populatedExchanges) {
      if (item.last_price > 0) {
        latestUsd = item.last_price;
        source = item.name || 'Exchange';
        break;
      }
    }
  }

  if (latestUsd > 0) {
    const btcRate = await getBtcUsdRate();
    const btcVal = latestUsd / btcRate;
    const btcEstimate = btcVal < 0.00000001 ? btcVal.toFixed(10) : btcVal.toFixed(8);

    lastKnownPrice = {
      last_price_usd: latestUsd < 0.01 ? latestUsd.toFixed(8) : latestUsd.toFixed(4),
      last_price_usdt: latestUsd < 0.01 ? latestUsd.toFixed(8) : latestUsd.toFixed(4),
      last_price_btc: btcEstimate,
      source,
      last_updated: Date.now(),
    };
  }

  const result = {
    price: lastKnownPrice,
    exchanges: populatedExchanges,
  };

  // Cache full market data for 30 seconds
  dynamicCache.set('market_full_data', result, { ttl: 30000 });
  dynamicCache.set('market_price', lastKnownPrice, { ttl: 30000 });

  return result;
}

/**
 * Returns latest price object (used by index page, header, and /ext APIs)
 */
async function fetchPrice() {
  const cached = dynamicCache.get('market_price');
  if (cached && cached.last_price_usd !== '0.00') return cached;

  const data = await getMarketData();
  return data.price;
}

/**
 * Returns populated exchanges list with live prices and 24h volumes
 */
async function getExchangesList() {
  const data = await getMarketData();
  return data.exchanges;
}

module.exports = {
  fetchPrice,
  getExchangesList,
  getMarketData,
  extractPriceAndVolume,
};
