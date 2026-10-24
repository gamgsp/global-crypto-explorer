const { execSync, exec } = require('child_process');
const https = require('https');
const path = require('path');
const fs = require('fs');

const REPO_OWNER = 'gamgsp';
const REPO_NAME = 'global-crypto-explorer';
const GITHUB_API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/commits/main`;

let cachedStatus = null;
let lastCheckTime = 0;
const CACHE_TTL = 300000; // 5 minutes cache

function getLocalCommit() {
  try {
    const cwd = path.resolve(__dirname, '..');
    const sha = execSync('git rev-parse HEAD', { cwd, encoding: 'utf8', timeout: 5000 }).trim();
    const shortSha = sha.slice(0, 7);
    const msg = execSync('git log -1 --format=%s', { cwd, encoding: 'utf8', timeout: 5000 }).trim();
    const date = execSync('git log -1 --format=%cd --date=relative', { cwd, encoding: 'utf8', timeout: 5000 }).trim();
    
    let version = '1.0.0';
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
      if (pkg.version) version = pkg.version;
    } catch {}

    return {
      version,
      sha,
      shortSha,
      msg,
      date,
    };
  } catch (err) {
    return {
      version: '1.0.0',
      sha: 'unknown',
      shortSha: 'unknown',
      msg: 'Git information unavailable',
      date: 'unknown',
    };
  }
}

function fetchRemoteViaGit() {
  try {
    const cwd = path.resolve(__dirname, '..');
    const out = execSync('git ls-remote origin refs/heads/main', { cwd, encoding: 'utf8', timeout: 8000 }).trim();
    const sha = out.split(/\s+/)[0];
    if (sha && sha.length >= 7) {
      return {
        sha,
        shortSha: sha.slice(0, 7),
        msg: 'Latest commit on main',
        date: new Date().toISOString(),
        author: 'GitHub',
      };
    }
  } catch {}
  return null;
}

function fetchRemoteCommit() {
  return new Promise((resolve) => {
    const req = https.get(GITHUB_API_URL, {
      headers: {
        'User-Agent': 'Global-Crypto-Explorer',
        'Accept': 'application/vnd.github.v3+json',
      },
      timeout: 8000,
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const json = JSON.parse(body);
            resolve({
              sha: json.sha,
              shortSha: json.sha ? json.sha.slice(0, 7) : '',
              msg: json.commit && json.commit.message ? json.commit.message.split('\n')[0] : 'Latest update',
              date: json.commit && json.commit.author ? json.commit.author.date : '',
              author: json.commit && json.commit.author ? json.commit.author.name : 'GitHub',
            });
          } catch (e) {
            resolve(fetchRemoteViaGit());
          }
        } else {
          resolve(fetchRemoteViaGit());
        }
      });
    });

    req.on('error', () => {
      resolve(fetchRemoteViaGit());
    });

    req.on('timeout', () => {
      req.destroy();
      resolve(fetchRemoteViaGit());
    });
  });
}

async function checkUpdate(force = false) {
  const now = Date.now();
  if (!force && cachedStatus && (now - lastCheckTime < CACHE_TTL)) {
    return cachedStatus;
  }

  const local = getLocalCommit();
  let remote = null;
  let error = null;

  try {
    remote = await fetchRemoteCommit();
  } catch (e) {
    error = e.message;
  }

  const updateAvailable = !!(remote && remote.sha && local.sha && !remote.sha.startsWith(local.shortSha) && !local.sha.startsWith(remote.shortSha));

  cachedStatus = {
    updateAvailable,
    local,
    remote,
    error,
    checkedAt: new Date().toLocaleTimeString(),
  };
  lastCheckTime = now;

  return cachedStatus;
}

function runUpdate() {
  return new Promise((resolve, reject) => {
    const cwd = path.resolve(__dirname, '..');
    const cmd = 'git fetch origin main 2>&1 && git reset --hard origin/main 2>&1 && npm install --omit=dev 2>&1';

    exec(cmd, { cwd, timeout: 60000 }, (err, stdout, stderr) => {
      if (err) {
        return reject(new Error(`Update failed: ${err.message}\n${stderr}`));
      }

      cachedStatus = null;
      lastCheckTime = 0;

      // Gracefully restart systemd service
      setTimeout(() => {
        try {
          exec('sudo systemctl restart global-crypto-explorer.service', { timeout: 3000 }, () => {
            process.exit(0);
          });
        } catch {
          process.exit(0);
        }
      }, 1500);

      const verboseLog = [stdout, stderr].filter(Boolean).join('\n').trim();
      resolve({
        success: true,
        output: verboseLog,
        message: 'Update applied successfully! The service is restarting with the new build...',
      });
    });
  });
}

module.exports = {
  getLocalCommit,
  checkUpdate,
  runUpdate,
};
