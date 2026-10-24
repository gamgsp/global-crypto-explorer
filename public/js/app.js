// Live Polling & Interactive Utilities
document.addEventListener('DOMContentLoaded', () => {
  // Mobile navigation drawer toggle
  const menuBtn = document.getElementById('mobileMenuToggle');
  const navMenu = document.getElementById('navMenu');
  if (menuBtn && navMenu) {
    menuBtn.addEventListener('click', () => {
      navMenu.classList.toggle('active');
    });
  }

  // Helper for formatting time elapsed
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

  // 1-Minute (60-second) Auto-refresh timer with visible badge countdown
  let countdown = 60;
  const refreshBadge = document.getElementById('autoRefreshSec');

  setInterval(() => {
    countdown--;
    if (refreshBadge) refreshBadge.innerText = countdown + 's';

    if (countdown <= 0) {
      countdown = 60; // Reset timer
      refreshPageData(); // In-place asynchronous data update without full page reload!
    }
  }, 1000);

  // In-place silent data refresh for tables
  async function refreshPageData() {
    const isHomePage = window.location.pathname === '/' || window.location.pathname === '';
    if (isHomePage) {
      try {
        const res = await fetch('/api/latest-blocks-txs');
        if (res.ok) {
          const data = await res.json();
          if (data.stats) {
            const elBlockCount = document.getElementById('statBlockCount');
            if (elBlockCount && data.stats.blockCount) elBlockCount.innerText = data.stats.blockCount;
            const elMempool = document.getElementById('statMempool');
            if (elMempool && data.stats.mempoolSize !== undefined) elMempool.innerText = 'Mempool: ' + data.stats.mempoolSize + ' txs';
            const elSupply = document.getElementById('statCirculatingSupply');
            if (elSupply && data.stats.circulatingSupply) elSupply.innerText = data.stats.circulatingSupply;
            const elMn = document.getElementById('statMasternodes');
            if (elMn && data.stats.masternodes !== undefined) elMn.innerText = data.stats.masternodes + ' / ' + data.stats.totalMasternodes;
            const elDiff = document.getElementById('statDifficulty');
            if (elDiff && data.stats.difficulty) elDiff.innerText = data.stats.difficulty;
            const elHashrate = document.getElementById('statHashrate');
            if (elHashrate && data.stats.hashrate) elHashrate.innerText = 'Hashrate: ' + data.stats.hashrate;
            const elConn = document.getElementById('statConnections');
            if (elConn && data.stats.connections !== undefined) elConn.innerText = data.stats.connections + ' Peers';
          }

          const urlParams = new URLSearchParams(window.location.search);
          const blockPage = parseInt(urlParams.get('blockPage') || '1', 10);
          const txPage = parseInt(urlParams.get('txPage') || '1', 10);

          if (blockPage === 1 && data.blocks && data.blocks.length > 0) {
            const blocksBody = document.getElementById('latestBlocksBody');
            if (blocksBody) {
              blocksBody.innerHTML = data.blocks.map(b => `
                <tr>
                  <td class="mono font-bold">
                    <a href="/block/${b.height}" class="height-link">#${b.height}</a>
                  </td>
                  <td class="mono">
                    <a href="/block/${b.hash}" class="address-link" title="${b.hash}">
                      ${b.hash}
                    </a>
                  </td>
                  <td><span class="badge badge-cyan">${b.txCount} txs</span></td>
                  <td class="mono" style="color: var(--text-muted);">${b.formattedSize}</td>
                  <td style="color: var(--text-muted);">${b.formattedAge || (b.age + 's ago')}</td>
                </tr>
              `).join('');
            }
          }

          if (txPage === 1 && data.txs && data.txs.length > 0) {
            const txsBody = document.getElementById('recentTxsBody');
            if (txsBody) {
              txsBody.innerHTML = data.txs.map(t => `
                <tr>
                  <td class="mono">
                    <a href="/tx/${t.txid}" class="address-link" title="${t.txid}">
                      ${t.txid}
                    </a>
                  </td>
                  <td class="mono">
                    <a href="/block/${t.height}">#${t.height}</a>
                  </td>
                  <td style="color: var(--text-muted);">${t.formattedAge || (t.age + 's ago')}</td>
                </tr>
              `).join('');
            }
          }
        }
      } catch (e) {
        console.error('Silent refresh failed:', e);
      }
    }
  }

  // Auto-refresh footer block height & connection stats every 15s
  function updateStats() {
    fetch('/ext/getsummary', { headers: { 'footer-only': 'true' } })
      .then(res => res.json())
      .then(data => {
        const blkEl = document.getElementById('footerBlockCount');
        const connEl = document.getElementById('footerConnCount');
        if (blkEl && data.blockcount) blkEl.innerText = Number(data.blockcount).toLocaleString() + ' blocks';
        if (connEl && data.connections !== undefined) connEl.innerText = data.connections + ' connections';
      })
      .catch(() => {});
  }

  setInterval(updateStats, 15000);
  updateStats();
});

// Interactive API Tester for /info page
function testApi(endpoint, targetId) {
  const box = document.getElementById(targetId);
  if (!box) return;

  box.style.display = 'block';
  box.innerText = 'Calling ' + endpoint + ' ...';

  fetch(endpoint)
    .then(async res => {
      const text = await res.text();
      try {
        const json = JSON.parse(text);
        box.innerText = JSON.stringify(json, null, 2);
      } catch {
        box.innerText = text;
      }
    })
    .catch(err => {
      box.innerText = 'Error calling API: ' + err.message;
    });
}

// Copy to clipboard helper
function copyToClipboard(text, btnElement) {
  navigator.clipboard.writeText(text).then(() => {
    if (btnElement) {
      const originalText = btnElement.innerText;
      btnElement.innerText = 'Copied!';
      setTimeout(() => { btnElement.innerText = originalText; }, 1500);
    }
  });
}
