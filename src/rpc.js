const http = require('http');
const config = require('./config');
const { blockCache, txCache } = require('./cache');

class RpcClient {
  constructor() {
    this.idCounter = 1;
    this.maxConcurrent = 25;
    this.activeRequests = 0;
    this.queue = [];
    this.inFlight = new Map();

    this.isOnline = false;
    this.lastKnown = {
      height: 0,
      difficulty: 0,
      connections: 0,
      hashps: 0,
      masternodes: { total: 0, enabled: 0, qualify: 0 },
      lastUpdated: 0,
    };

    this.isPolling = false;
    this.startBackgroundPoller();
  }

  getRpcConfig() {
    return config.getConfig().rpc;
  }

  _doRpcCall(method, params = []) {
    return new Promise((resolve, reject) => {
      const rpcConf = this.getRpcConfig();
      const payload = JSON.stringify({
        jsonrpc: '1.0',
        id: this.idCounter++,
        method: method,
        params: params,
      });

      const options = {
        hostname: rpcConf.host,
        port: rpcConf.port,
        path: '/',
        method: 'POST',
        auth: `${rpcConf.user}:${rpcConf.password}`,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'Connection': 'close',
        },
        timeout: rpcConf.timeout || 10000,
      };

      const req = http.request(options, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          this.isOnline = true;
          if (res.statusCode === 401) {
            return reject(new Error('RPC 401 Unauthorized'));
          }
          if (res.statusCode === 500 && body.includes('Work queue depth exceeded')) {
            return reject(new Error('RPC queue full'));
          }
          try {
            const data = JSON.parse(body);
            if (data.error) {
              return reject(data.error);
            }
            resolve(data.result);
          } catch (err) {
            reject(new Error(`Failed to parse RPC: ${err.message}`));
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        this.isOnline = false;
        this.lastKnown.connections = 0;
        reject(new Error(`RPC timeout for: ${method}`));
      });

      req.on('error', (err) => {
        this.isOnline = false;
        this.lastKnown.connections = 0;
        reject(err);
      });

      req.write(payload);
      req.end();
    });
  }

  _dequeue() {
    if (this.queue.length === 0 || this.activeRequests >= this.maxConcurrent) {
      return;
    }
    const item = this.queue.shift();
    this.activeRequests++;

    this._doRpcCall(item.method, item.params)
      .then(res => item.resolve(res))
      .catch(err => item.reject(err))
      .finally(() => {
        this.activeRequests--;
        this._dequeue();
      });
  }

  call(method, params = []) {
    const dedupeKey = `${method}:${JSON.stringify(params)}`;
    if (this.inFlight.has(dedupeKey)) {
      return this.inFlight.get(dedupeKey);
    }

    const promise = new Promise((resolve, reject) => {
      this.queue.push({ method, params, resolve, reject });
      this._dequeue();
    }).finally(() => {
      this.inFlight.delete(dedupeKey);
    });

    this.inFlight.set(dedupeKey, promise);
    return promise;
  }

  async startBackgroundPoller() {
    const poll = async () => {
      if (this.isPolling) return;
      this.isPolling = true;

      try {
        const count = await this.call('getblockcount');
        if (count !== null && count >= 0) {
          this.lastKnown.height = count;
          this.isOnline = true;
        }

        await new Promise(r => setTimeout(r, 150));

        const conns = await this.call('getconnectioncount').catch(() => 0);
        this.lastKnown.connections = conns !== null ? conns : 0;

        await new Promise(r => setTimeout(r, 150));

        const diff = await this.call('getdifficulty').catch(() => 0);
        this.lastKnown.difficulty = diff !== null ? diff : 0;

        await new Promise(r => setTimeout(r, 150));

        if (Date.now() - (this.lastKnown.mnPolled || 0) > 60000) {
          try {
            const mn = await this.call('smartnode', ['count']).catch(() => this.call('masternode', ['count']));
            if (mn) this.lastKnown.masternodes = mn;
            this.lastKnown.mnPolled = Date.now();
          } catch {
            this.lastKnown.masternodes = { total: 0, enabled: 0 };
          }
        }

        this.lastKnown.lastUpdated = Date.now();
      } catch (err) {
        this.isOnline = false;
        this.lastKnown.connections = 0;
      } finally {
        this.isPolling = false;
      }
    };

    await poll();
    setInterval(poll, 15000);
  }

  async getBlockCount() {
    if (this.isOnline && this.lastKnown.height >= 0 && Date.now() - this.lastKnown.lastUpdated < 20000) {
      return this.lastKnown.height;
    }
    try {
      const count = await this.call('getblockcount');
      this.lastKnown.height = count;
      this.isOnline = true;
      return count;
    } catch {
      this.isOnline = false;
      return 0;
    }
  }

  async getDifficulty() {
    try {
      const diff = await this.call('getdifficulty');
      const d = (diff !== null && diff !== undefined) ? diff : 0;
      this.lastKnown.difficulty = d;
      this.isOnline = true;
      return d;
    } catch {
      this.isOnline = false;
      this.lastKnown.difficulty = 0;
      return 0;
    }
  }

  async getConnectionCount() {
    try {
      const conns = await this.call('getconnectioncount');
      const count = (conns !== null && conns !== undefined) ? conns : 0;
      this.lastKnown.connections = count;
      this.isOnline = true;
      return count;
    } catch {
      this.isOnline = false;
      this.lastKnown.connections = 0;
      return 0;
    }
  }

  async getBlockHash(index) {
    const idx = parseInt(index, 10);
    const cacheKey = `blkhash_${idx}`;
    if (blockCache.has(cacheKey)) {
      return blockCache.get(cacheKey);
    }
    const hash = await this.call('getblockhash', [idx]);
    if (hash) {
      blockCache.set(cacheKey, hash);
    }
    return hash;
  }

  async getBlock(hashOrHeight, verbosity = 1) {
    let hash = hashOrHeight;
    if (typeof hashOrHeight === 'number' || (!isNaN(hashOrHeight) && String(hashOrHeight).length < 10)) {
      hash = await this.getBlockHash(hashOrHeight);
    }
    const cacheKey = `blk_${hash}_${verbosity}`;
    if (blockCache.has(cacheKey)) {
      return blockCache.get(cacheKey);
    }

    const block = await this.call('getblock', [hash, verbosity]);
    if (block && block.confirmations > 10) {
      blockCache.set(cacheKey, block);
    }
    return block;
  }

  async getRawTransaction(txid, decrypt = 1) {
    const cacheKey = `tx_${txid}_${decrypt}`;
    if (txCache.has(cacheKey)) {
      return txCache.get(cacheKey);
    }

    const tx = await this.call('getrawtransaction', [txid, decrypt]);
    if (tx && tx.confirmations > 10) {
      txCache.set(cacheKey, tx);
    }
    return tx;
  }

  async getNetworkHashps() {
    try {
      return await this.call('getnetworkhashps');
    } catch {
      return 0;
    }
  }

  async getPeerInfo() {
    try {
      return await this.call('getpeerinfo');
    } catch {
      return [];
    }
  }

  async getMasternodeCount() {
    if (!this.isOnline) return { total: 0, enabled: 0 };
    return this.lastKnown.masternodes || { total: 0, enabled: 0 };
  }

  async getMasternodeList(mode = 'json') {
    try {
      return await this.call('smartnodelist', [mode]).catch(() => this.call('masternodelist', [mode]));
    } catch {
      return {};
    }
  }

  async getAddressBalance(address) {
    try {
      return await this.call('getaddressbalance', [{ addresses: [address] }]);
    } catch {
      return { balance: 0, received: 0 };
    }
  }

  async getAddressUtxos(address) {
    try {
      return await this.call('getaddressutxos', [{ addresses: [address] }]);
    } catch {
      return [];
    }
  }

  async getAddressDeltas(address, start = 0, end = 0) {
    try {
      const params = { addresses: [address] };
      if (start > 0) params.start = start;
      if (end > 0) params.end = end;
      return await this.call('getaddressdeltas', [params]);
    } catch {
      return [];
    }
  }

  async getBlockchainInfo() {
    return await this.call('getblockchaininfo');
  }

  async getNetworkInfo() {
    return await this.call('getnetworkinfo');
  }

  async verifyMessage(address, signature, message) {
    try {
      return await this.call('verifymessage', [address, signature, message]);
    } catch {
      return false;
    }
  }

  async getChainTips() {
    try {
      return await this.call('getchaintips');
    } catch {
      return [];
    }
  }

  async getRecentBlocks(limit = 10) {
    try {
      const tip = await this.getBlockCount();
      const blocks = [];
      for (let h = tip; h > Math.max(0, tip - limit); h--) {
        try {
          const b = await this.getBlock(h, 1);
          if (b) blocks.push(b);
        } catch {}
      }
      return blocks;
    } catch {
      return [];
    }
  }

  async getMempoolInfo() {
    try {
      return await this.call('getmempoolinfo');
    } catch {
      return { size: 0, bytes: 0 };
    }
  }
}

module.exports = new RpcClient();
