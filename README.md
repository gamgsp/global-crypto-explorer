# Global Crypto Explorer 🌐🚀

[![Node.js](https://img.shields.io/badge/Node.js-18+-68a063?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Database](https://img.shields.io/badge/Database-SQLite3-003B57?style=for-the-badge&logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![RPC](https://img.shields.io/badge/Node-Direct--RPC-blue?style=for-the-badge&logo=bitcoin&logoColor=white)](https://bitcoin.org/)
[![License](https://img.shields.io/badge/License-MIT-orange?style=for-the-badge)](LICENSE)

**Global Crypto Explorer** is a universal, high-performance, direct-RPC blockchain explorer and analytics intelligence engine built for any **Bitcoin, Dash, PIVX, or fork-based cryptocurrency**.

Engineered with **Node.js, Express, and Better-SQLite3**, it completely removes the heavy complexity and massive RAM overhead of legacy explorer stacks (such as Insight, Iquidus, or MongoDB-based explorers). Global Crypto Explorer delivers **100% authentic on-chain data** directly from your local daemon, instantaneous page loads via embedded SQLite caching, an **integrated Web Admin Control Panel**, custom theme styling, and white-label branding.

---

## 📑 Table of Contents
- [Key Features](#key-features)
- [Project Architecture](#project-architecture)
- [Complete Tour of Explorer Pages](#complete-tour-of-explorer-pages)
- [Web Admin Control Panel Tour](#web-admin-control-panel-tour)
- [SQLite Database Architecture & Server Migration](#sqlite-database-architecture-server-migration)
- [Prerequisites](#prerequisites)
- [⚡ Universal 1-Click Automated Setup Script (`setup.sh`)](#universal-1-click-automated-setup-script-setupsh)
- [Manual Quick Start Installation](#manual-quick-start-installation)
- [First-Run Setup Wizard](#first-run-setup-wizard)
- [Web Server & Reverse Proxy Configurations](#web-server-reverse-proxy-configurations)
  - [Option 1: Nginx (Recommended)](#option-1-nginx-recommended)
  - [Option 2: Apache2](#option-2-apache2)
  - [Option 3: Caddy (Automatic SSL)](#option-3-caddy-automatic-ssl)
  - [Option 4: Cloudflare Tunnels (Zero Open Ports)](#option-4-cloudflare-tunnels-zero-open-ports)
  - [Option 5: Direct Node.js (No Reverse Proxy) & Security Warning](#option-5-direct-nodejs-no-reverse-proxy-security-warning)
- [Production Daemon Service (Systemd & PM2)](#production-daemon-service-systemd-pm2)
- [REST API Reference](#rest-api-reference)
- [🏢 Developed By & Ecosystem Platforms](#developed-by-ecosystem-platforms)
- [License](#license)

---

## 🌟 Key Features

- **⚡ Direct-RPC Architecture:** Communicates natively with your coin daemon (`coind`) over JSON-RPC. Zero middle layers.
- **🚀 Embedded SQLite Caching:** Blocks, transactions, and address ledgers are cached in `data/explorer.db` for sub-millisecond query performance.
- **🔄 Real-Time Synchronization:** Continuously tracks and indexes blocks as they are mined on the network.
- **🛡️ 100% Real Blockchain Data:** Every metric—circulating supply, difficulty, hashrate, block rewards, and balances—is calculated mathematically from blockchain ground-truth. Zero mock data.
- **🎨 Complete White-Label Branding:** Customize the coin name, ticker, logos, Google fonts, background colors/images, and card styles via the Admin Panel.
- **🔐 Secret Admin Slug Protection:** Secure your administrative portal behind a custom secret path (e.g., `/gamus` or `/my-secret-admin`) without exposing standard `/admin` routes.
- **📈 Interactive 4-Tab Charts:** Beautiful Chart.js visualizations for Transactions, PoW Difficulty, PoW Hashrate (in MH/s), and Daily Blocks across 7D, 15D, and 30D.
- **🐋 Whale Movement & Richlist:** Dedicated monitors for the Top 100 largest coin movements (> 1M transfers) and wealth distribution tiers.
- **✍️ Cryptographic Address Claiming:** Allows users to verify address ownership using native ECDSA message signatures (`verifymessage` RPC).
- **⛓️ Consensus & Fork Tracker:** Real-time orphaned block tracker querying `getchaintips` RPC to verify linear chain health.
- **🔌 Standard REST APIs:** Comprehensive endpoints compatible with Iquidus and Insight APIs for third-party trackers, bots, and exchanges.

---

## 🏗️ Project Architecture

```
global-crypto-explorer/
├── data/                          # SQLite runtime database & claims (persisted)
│   └── .gitkeep
├── public/                        # Static assets
│   ├── css/style.css              # Glassmorphism dark-theme CSS & responsive tokens
│   ├── js/main.js                 # Real-time WebSocket / auto-refresh scripts
│   └── img/                       # Default coin logos and branding
├── src/
│   ├── config.js                  # Configuration loader & DB settings bridge
│   ├── db.js                      # Better-SQLite3 schema & prepared queries
│   ├── indexer.js                 # High-speed block, transaction & address indexer
│   ├── market.js                  # Exchange price fetching & orderbook data
│   ├── richlist.js                # Authoritative richlist calculation
│   ├── rpc.js                     # Direct JSON-RPC daemon client
│   ├── server.js                  # Express HTTP server entry point
│   ├── supply.js                  # Coin supply calculation formulas
│   └── routes/
│       ├── admin.js               # Admin Dashboard & Setup Wizard controller
│       ├── api.js                 # General JSON API routes
│       ├── ext.js                 # Iquidus/Insight-compatible REST API endpoints
│       └── ui.js                  # Front-end EJS page routes
├── views/                         # Modern EJS front-end templates
│   ├── partials/                  # Header, footer, and navigation partials
│   ├── index.ejs                  # Homepage with live dual tables & charts
│   ├── block.ejs                  # Block explorer detail page
│   ├── tx.ejs                 # Transaction detail page with vin/vout breakdown
│   ├── address.ejs                # Address page with full paginated history
│   ├── richlist.ejs               # Top 100 richlist & wealth distribution tiers
│   ├── movement.ejs               # Top 100 largest coin movements
│   ├── masternodes.ejs            # Masternode / Smartnode network list
│   ├── orphans.ejs                # Chain tips & orphan tracker
│   ├── market.ejs                 # Exchange prices & volume
│   ├── claim.ejs                  # Cryptographic message verification & claiming
│   ├── info.ejs                   # Full interactive API documentation
│   └── setup.ejs                  # 1st-run setup wizard
├── .env.example                   # Template environment configuration
├── global-crypto-explorer.service # Systemd service unit template
└── package.json                   # Dependencies & project scripts
```

---

## 🧭 Complete Tour of Explorer Pages

### 1. Homepage (`/`)
- **Key Metrics Grid:** Instant live snapshot of current Block Height, Mempool Transaction count, Circulating Supply, Real-Time Price & Market Cap, Active Masternodes/Smartnodes, PoW Mining Difficulty, Network Hashrate, and Connected P2P Peer count.
- **Interactive Network Activity Charts:** 4 switchable tabs:
  - **Daily Transactions:** Real transaction volume per day.
  - **Mining Difficulty:** Historical PoW difficulty curve.
  - **Network Hashrate:** PoW hashrate in MH/s calculated via:
    $$\text{Hashrate (MH/s)} = \frac{\text{Difficulty} \times 2^{32}}{\text{Target Time (150s)} \times 10^6}$$
  - **Daily Blocks:** Quantity of blocks mined per calendar day.
  - Timeframe toggles for **7 Days**, **15 Days**, and **30 Days**.
- **Symmetrical Live Dual Tables:** Side-by-side **Latest Blocks** (Height, Hash, Txs count, Size, Age) and **Recent Transactions** (TxID, Block Height, Value, Age) with synchronized 20-row pagination and uniform card heights.

### 2. Block Detail Page (`/block/:hash` or `/block/:height`)
- Comprehensive block header overview: Height, Confirmation count, Block Hash, Previous Block Hash, Next Block Hash, Merkle Root, Timestamp, Number of Transactions, Size (in KB), Difficulty, Bits, Nonce, and Version.
- Complete table of all transactions included in the block with direct links.

### 3. Transaction Detail Page (`/tx/:txid`)
- Visual double-entry ledger displaying **Input Addresses (Vin)** and **Recipient Addresses (Vout)** with exact coin amounts.
- Displays transaction confirmation count, block height, total output value, transaction fee, and raw hex link.

### 4. Address Detail Page (`/address/:address`)
- Real-time address balance ledger:
  - **Final Balance:** Current spendable balance.
  - **Total Received:** Cumulative lifetime coins received.
  - **Total Sent:** Cumulative lifetime coins transferred out.
  - **Total Transactions:** Number of transactions involving this address.
- **Interactive QR Code:** Generates instant scannable QR code modal for mobile wallet transfers.
- **Transaction History Table:** Fully paginated list (20 transactions per page) displaying TxID, Block Height, Amount (+/-), and Age.

### 5. Top 100 Richlist & Wealth Distribution (`/richlist`)
- **Top 100 Ranked Addresses:** Ranks the 100 wealthiest addresses on the network, displaying Rank (#1 to #100), Address, Verified Ownership Claim Badge, Balance, and Percentage of Circulating Supply.
- **Wealth Distribution Tiers:** Mathematical breakdown of coin concentration:
  - **Top 1–25:** Total amount & percentage of supply.
  - **Top 26–50:** Total amount & percentage of supply.
  - **Top 51–75:** Total amount & percentage of supply.
  - **Top 76–100:** Total amount & percentage of supply.
  - **Rest of Network:** Remaining coins in general circulation.

### 6. Top 100 Coin Movements (`/movement`)
- Dedicated high-value whale transfer feed.
- Queries and ranks the **Top 100 largest historical coin transactions** on the network in descending order from highest to lowest.
- Displays Rank, Transaction ID, Block Height, Transferred Amount, `WHALE (> 1M)` badge, and Age.

### 7. Masternodes / Smartnodes Page (`/masternodes`)
- Complete network list of collateralized nodes.
- Displays node IP Address, Collateral TxID, Payee Address, Active Status (`ENABLED`, `PRE_ENABLED`, etc.), Protocol Version, and Last Seen Uptime.
- *Note:* This page can be completely hidden via the Admin Panel if your cryptocurrency does not use masternodes.

### 8. Consensus & Orphan Tracker (`/orphans`)
- Direct integration with native `getchaintips` RPC.
- Displays all valid forks, headers-only tips, or orphaned branches on the network along with their block height, branch length, and fork point.
- When no orphaned blocks exist, it displays a clean zero-state confirmation: *"The blockchain consensus is 100% linear and healthy with 0 orphaned blocks."*

### 9. Market & Exchange Data (`/market`)
- Real-time price tracking in USD and USDT.
- Displays 24-hour trading volume, circulating market cap, and external direct links to trading pairs on configured exchanges.

### 10. Address Ownership Claiming (`/claim`)
- Cryptographic verification tool allowing coin holders to link their public profile, company name, or pseudonym to their wallet address on the Richlist.
- Users sign their chosen name using their desktop/core wallet (`Sign Message` feature) and submit the address, display name, and signature.
- The explorer verifies the ECDSA signature via `verifymessage` RPC. If valid, the verified badge and claim name are permanently attached to the address.

### 11. Interactive REST API Documentation (`/info`)
- Full interactive developer portal listing all 20+ available REST API endpoints.
- Includes integrated **Test** buttons allowing developers to test API calls in real-time and inspect JSON output directly in the browser.
- Automatically adjusts all example endpoint URLs to reflect your live production domain.

---

## 🎛️ Web Admin Control Panel Tour

The Admin Control Panel allows the project owner to manage every aspect of the explorer from a responsive web dashboard without touching code or editing server files.

### 1. Secret Admin Slug & Authentication
- Protected by a user-defined URL slug (e.g. `yourdomain.com/gamus`).
- Authenticated via secure bcrypt-hashed passwords stored in SQLite.

### 2. Coin & General Branding
- **Coin Name & Symbol:** Update project name and ticker (e.g., `Bitcoin`, `BTC`).
- **Coin Decimals:** Configure decimal precision (default: `8`).
- **Official Links:** Set project website, whitepaper URL, and block time.
- **Logos & Branding:** Set custom URLs for your Coin Logo and Favicon.

### 3. Node RPC Configuration
- Update Daemon Host (`127.0.0.1`), Port, RPC Username, and RPC Password.
- Changes take effect immediately without requiring an application restart.

### 4. Appearance & Visual Theme Customizer
- **Typography:** Choose from modern Google Fonts (Inter, Outfit, Roboto, Poppins, Montserrat, Space Grotesk, etc.).
- **Background Styling:** Choose between a sleek solid color or provide a custom high-resolution Background Image URL.
- **Glassmorphism & Cards:** Customize card background opacity, border colors, and border radius.
- **Color Palette:** Customize Primary Text, Muted Text, Accent Colors, and button hover highlights.

### 5. Hero Banner Section
- Enable or disable the top homepage hero banner.
- Edit the headline title, subtitle description, and live pulse badge text.
- Upload or link a custom rotating coin image.

### 6. Social Profiles & Communities
- Dynamic dropdown interface allowing you to add links to your project's community profiles:
  - CoinMarketCap, CoinGecko, Coinpaprika
  - Twitter / X, Telegram, Discord
  - GitHub, Reddit, Medium, Facebook, WhatsApp, YouTube
- Displays attractive branded icons in the navigation bar and footer.

### 7. Footer Customization
- Enter custom copyright notices.
- Automatic dynamic current year tag (`{year}` auto-resolves to the present year).
- Add unlimited custom clickable footer links with customizable anchor text and URLs.

### 8. Feature Toggles
- **Masternodes Toggle:** Enable or disable the Masternodes tab (and rename the label to "Smartnodes", "Masternodes", or any custom name).
- **Default Chart Timeframe:** Set the initial chart view to 7D, 15D, or 30D.

### 9. System Updates & 1-Click GitHub Sync
- **Live GitHub Update Detection:** The explorer checks the official GitHub repository (`gamgsp/global-crypto-explorer`) asynchronously in the background with intelligent 5-minute caching.
- **Visual Notification Badges:** When a new commit or release is published on GitHub, a prominent `UPDATE` badge appears in the admin sidebar navigation and a global announcement banner appears across all settings tabs displaying the commit SHA, commit message, author, and timestamp.
- **Dedicated System & Updates Tab (`/:slug?tab=updates`):** Inspect your installed commit SHA against the remote commit SHA, commit author, and build date.
- **1-Click Seamless Upgrade:** Clicking **"Update App from GitHub Now"** opens an interactive terminal log that executes `git fetch origin main && git reset --hard origin/main && npm install --omit=dev`, and gracefully restarts the `global-crypto-explorer.service` with automated reconnection.

---

## 💾 SQLite Database Architecture & Server Migration

Global Crypto Explorer utilizes **Better-SQLite3**, an ultra-fast, serverless, single-file relational database engine operating in Write-Ahead Logging (WAL) mode.

### Directory Structure of `data/`:
```
data/
├── explorer.db         # Primary SQLite database (Blocks, Txs, Addresses, Admin Settings)
├── explorer.db-wal     # Write-Ahead Log file (active transaction log)
├── explorer.db-shm     # Shared memory index
└── claims.json         # Cryptographically verified address claims
```

### What is stored inside `data/explorer.db`?
1. **`settings` table:** Contains your complete Admin configuration: hashed administrator password, custom admin URL slug, full theme styles, hero banner settings, social links, footer links, and RPC credentials.
2. **`blocks` table:** Indexed block headers, heights, hashes, difficulties, and timestamps.
3. **`txs` table:** Transaction IDs, block associations, input/output counts, and total transfer amounts.
4. **`addresses` table:** Known wallet addresses, spendable balances, total received, total sent, and transaction counts.
5. **`address_txs` table:** Historical transaction mappings for individual wallet addresses.

### 📦 How to Backup & Migrate to Another Server
Because all application state, admin settings, and indexed blockchain data reside inside the **`data/`** directory, backing up and migrating your explorer to a new server is simple:

#### Step 1: Create a Clean Backup
Before copying, stop the explorer service to ensure WAL checkpoints are flushed:
```bash
sudo systemctl stop global-crypto-explorer
tar -czvf explorer-data-backup.tar.gz data/
sudo systemctl start global-crypto-explorer
```

#### Step 2: Restore on the New Server
On your new server, after cloning the repository:
```bash
# Extract the backup into the new installation
tar -xzvf explorer-data-backup.tar.gz -C /path/to/new/global-crypto-explorer/
```
Once restored, start the explorer. All your admin settings, custom styling, address claims, and indexed blocks will be immediately available.

---

## 📋 Prerequisites

1. **Node.js:** Version `18.0.0` or higher (LTS recommended).
2. **Coin Daemon (`coind`):** Any Bitcoin or Dash fork daemon running locally with JSON-RPC enabled.
   Ensure the following settings are present in your coin's configuration file (e.g. `~/.mycoin/mycoin.conf`):
   ```ini
   server=1
   listen=1
   rpcuser=your_rpc_username
   rpcpassword=your_secure_rpc_password
   rpcport=9998
   txindex=1
   addressindex=1
   spentindex=1
   rpcthreads=16
   rpcworkqueue=256
   ```

---

## ⚡ Universal 1-Click Automated Setup Script (`setup.sh`)

Global Crypto Explorer includes a fully automated, interactive, and unattended-capable installation script (`setup.sh`) designed for fresh Linux servers (**Ubuntu 20.04/22.04/24.04, Debian 11/12, CentOS/RHEL/AlmaLinux/Rocky 8/9**).

It handles **everything from A to Z** in a single execution:
1. Allocates 4GB swap memory if RAM is limited.
2. Installs Node.js v20 LTS, Git, build tools, UFW firewall, and Certbot.
3. Automatically asks an interactive questionnaire for Domain, Web Server, SSL, and Coin Daemon.
4. Automatically downloads, configures, and launches your **Crypto Coin Daemon** (`coind`) as a systemd service.
5. Configures your chosen reverse proxy (**Nginx**, **Apache2**, **Caddy**, or **Standalone Node.js**).
6. Issues free **Let's Encrypt SSL certificates** with automated auto-renewal.
7. Deploys Global Crypto Explorer, sets up `.env`, starts `global-crypto-explorer.service`, and executes firewall port validations.

---

### 🚀 Running the Automated Setup Script

#### Option A: One-Command Installation (Direct via cURL)
Run this single command on your clean server terminal:
```bash
curl -sSL https://raw.githubusercontent.com/gamgsp/global-crypto-explorer/main/setup.sh | sudo bash
```

#### Option B: From Cloned Repository
If you have already cloned the repository:
```bash
git clone https://github.com/gamgsp/global-crypto-explorer.git
cd global-crypto-explorer
sudo chmod +x setup.sh
sudo ./setup.sh
```

---

### 📋 Interactive Questionnaire & Automation Guide

The script will walk you through the following questionnaire:

```
╔═══════════════════════════════════════════════════════════════════════════╗
║                 CRYPTO BLOCKCHAIN EXPLORER                                ║
║            Universal Automated Deployment Engine                          ║
╚═══════════════════════════════════════════════════════════════════════════╝
```

#### Step 1: System Memory & Swap Allocation
- Checks current physical RAM and swap space.
- If swap is under 2GB, the script automatically provisions and mounts a **4GB `/swapfile`** with `vm.swappiness=20` to guarantee uninterrupted block indexing and Node.js dependency compilation.

#### Step 2: Domain & Application Port
- **Domain Name:** Enter your fully qualified domain (e.g. `explorer.gspcoin.us`) or server IP.
- **Node.js Port:** Enter internal port for the Node.js application (default: `3001`).

#### Step 3: Web Server & Reverse Proxy Selection
Choose your preferred web server stack:
- **`1) Nginx` (Recommended):** High-speed reverse proxy with WebSocket upgrade headers, gzip compression, and client body limits.
- **`2) Apache2`:** Configures `mod_proxy`, `mod_proxy_http`, `mod_ssl`, and `mod_rewrite` virtual host.
- **`3) Caddy`:** Ultra-lightweight reverse proxy with automatic native HTTPS.
- **`4) Standalone Node.js`:** Direct Node.js execution without a reverse proxy.

#### Step 4: SSL / HTTPS Encryption
- **`1) Let's Encrypt Free SSL` (Recommended):** Prompts for an administrator email and automatically provisions trusted SSL certificates with automated systemd renewal timers.
- **`2) Custom SSL Certificates`:** Prompts for paths to your custom `.crt` and `.key` files.
- **`3) No SSL / HTTP Only`:** For environments running behind Cloudflare Flexible SSL, reverse proxies, or local testing.

#### Step 5: Firewall & Port Verification
- Opens **Port 22 (SSH)** to prevent lockout.
- Opens **Port 80 (HTTP)** and **Port 443 (HTTPS)** for web access.
- Validates that the internal **Coin Daemon RPC Port is blocked from external internet access** (binding strictly to `127.0.0.1` for maximum security).
- Optionally opens the Coin P2P gossip port for public peer syncing.

#### Step 6: Crypto Coin Daemon Setup Questionnaire
The installer prompts:
> **`Do you want this autoscript to setup & configure your Coin Daemon too? (y/n)`**

- **If YES:**
  1. **Coin Name & Symbol:** e.g., `GSPCoin` and `GSPC`.
  2. **Daemon & CLI Binary Names:** e.g., `gspcoind` and `gspcoin-cli`.
  3. **P2P & RPC Ports:** Default P2P and RPC ports (e.g. `18181` and `18182`).
  4. **Auto-Generated RPC Credentials:** Generates a cryptographically random 32-character RPC username and password.
  5. **Binary Source:**
     - *Download from GitHub / URL:* Downloads archive (`.tar.gz`, `.zip`) or binary, extracts, and installs to `/usr/local/bin/`.
     - *Local file path:* Copies existing compiled binaries from your server.
     - *Already installed:* Uses existing binaries in `/usr/local/bin`.
  6. **Automated `<coin>.conf` Creation:** Generates the configuration with all required indexing flags:
     ```ini
     server=1
     daemon=1
     listen=1
     txindex=1
     addressindex=1
     spentindex=1
     timestampindex=1
     rpcuser=gspcrpc
     rpcpassword=GEN_SECURE_PASSWORD
     rpcallowip=127.0.0.1
     rpcport=18182
     port=18181
     maxconnections=64
     ```
  7. **Systemd Service Setup:** Creates and enables `/etc/systemd/system/<coin>d.service`, then starts the daemon in the background.

- **If NO:**
  - Enter your existing Daemon RPC Host (`127.0.0.1`), RPC Port, RPC Username, and RPC Password.

#### Step 7: Global Crypto Explorer Deployment & Systemd Service
- Clones repository or uses current directory.
- Runs `npm install --omit=dev`.
- Generates a hardened `.env` file containing RPC credentials and a cryptographically generated `SESSION_SECRET`.
- Creates, enables, and starts `/etc/systemd/system/global-crypto-explorer.service`.

#### Step 8: Completion Summary
Upon completion, the installer prints the live URL, first-time admin setup link, RPC parameters, and helpful system maintenance commands:

```
╔═══════════════════════════════════════════════════════════════════════════╗
║             GLOBAL CRYPTO EXPLORER INSTALLED SUCCESSFULLY!                ║
╚═══════════════════════════════════════════════════════════════════════════╝

  • Explorer URL:             https://explorer.gspcoin.us
  • First-Time Admin Setup:   https://explorer.gspcoin.us/setup
  • Service Status:           ONLINE & RUNNING
  • Coin Name / Symbol:       GSPCoin (GSPC)
  • RPC Endpoint:             127.0.0.1:18182
  • Web Server:               Nginx
```

---

## 🚀 Manual Quick Start Installation

### 1. Clone the Repository
```bash
git clone https://github.com/gamgsp/global-crypto-explorer.git
cd global-crypto-explorer
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Setup Environment File
Copy the provided `.env.example`:
```bash
cp .env.example .env
```
*(Optional)* You can customize your port or domain in `.env`:
```ini
PORT=3001
HOST=0.0.0.0
DOMAIN=https://explorer.yourdomain.com
RPC_HOST=127.0.0.1
RPC_PORT=9998
RPC_USER=your_rpc_username
RPC_PASSWORD=your_secure_rpc_password
```

### 4. Start the Application
```bash
npm start
```
The explorer will start and listen on `http://localhost:3001`.

---

## 🧙‍♂️ First-Run Setup Wizard

When you open the explorer in your browser for the first time:
1. The app automatically detects that no administrator is configured and redirects you to `/setup`.
2. Enter your **Administrator Name**, **Email**, and a **Strong Password**.
3. Set your **Custom Admin URL Slug** (e.g., `/gamus` or `/admin-portal`).
4. Enter your **Coin Details** (Name, Symbol, Logo URL).
5. Enter your **Daemon RPC Credentials** (Host, Port, User, Password).
6. Click **Save and Launch Explorer**.

Your configuration is written directly to `data/explorer.db`. From that point on, your admin dashboard is accessible only at your secret slug:
`http://yourdomain.com/YOUR_SECRET_SLUG`

---

## 🌐 Web Server & Reverse Proxy Configurations

While the explorer runs on port `3001`, in production you should route traffic through a standard web server for domain binding, SSL encryption (HTTPS), and request caching.

### Option 1: Nginx (Recommended)

Nginx is the standard reverse proxy for Node.js applications.

```nginx
server {
    listen 80;
    server_name explorer.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name explorer.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/explorer.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/explorer.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Option 2: Apache2

If your server runs Apache, enable the proxy modules:
```bash
sudo a2enmod proxy proxy_http proxy_wstunnel ssl rewrite headers
```

Then configure your VirtualHost (`/etc/apache2/sites-available/explorer.conf`):
```apache
<VirtualHost *:80>
    ServerName explorer.yourdomain.com
    Redirect permanent / https://explorer.yourdomain.com/
</VirtualHost>

<VirtualHost *:443>
    ServerName explorer.yourdomain.com

    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/explorer.yourdomain.com/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/explorer.yourdomain.com/privkey.pem

    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:3001/
    ProxyPassReverse / http://127.0.0.1:3001/

    RequestHeader set X-Forwarded-Proto "https"
</VirtualHost>
```

### Option 3: Caddy (Automatic SSL)

Caddy automatically provisions and renews Let's Encrypt SSL certificates with zero manual intervention.

Create a `Caddyfile`:
```caddy
explorer.yourdomain.com {
    reverse_proxy 127.0.0.1:3001
}
```
Run Caddy:
```bash
caddy run
```

### Option 4: Cloudflare Tunnels (Zero Open Ports)

Cloudflare Tunnels (`cloudflared`) allow you to expose your explorer to the public internet with full SSL without opening any ports on your firewall or exposing your server's IP address:

1. Install `cloudflared`:
   ```bash
   sudo apt-get install cloudflared
   ```
2. Authenticate and create a tunnel:
   ```bash
   cloudflared tunnel login
   cloudflared tunnel create explorer-tunnel
   ```
3. Route traffic in `~/.cloudflared/config.yml`:
   ```yaml
   tunnel: <TUNNEL_UUID>
   credentials-file: /root/.cloudflared/<TUNNEL_UUID>.json
   ingress:
     - hostname: explorer.yourdomain.com
       service: http://localhost:3001
     - service: http_status:404
   ```
4. Start the tunnel:
   ```bash
   cloudflared tunnel run explorer-tunnel
   ```

---

### Option 5: Direct Node.js (No Reverse Proxy) & Security Warning

Node.js is capable of listening directly on port `80` (HTTP) or running with native HTTPS by setting `PORT=80` in `.env`:
```ini
PORT=80
HOST=0.0.0.0
```

> [!WARNING]
> **Production Security Warning:**
> Exposing Node.js directly to the public internet on port 80 or 443 without a reverse proxy is **strongly discouraged** for public production deployments due to the following risks:
> 1. **Privilege Vulnerabilities:** Binding to ports below 1024 requires root/administrator privileges, meaning any theoretical vulnerability in Node.js or a dependency could grant an attacker root access to your machine.
> 2. **DDoS & Slowloris Vulnerability:** Reverse proxies like Nginx, Caddy, or Cloudflare have battle-tested kernel-level buffers to absorb slow HTTP attacks, malformed request flooding, and TCP buffer exhaustion. Node.js single-threaded event loop can become starved if exposed directly to malicious connection floods.
> 3. **Lack of Rate Limiting & SSL Offloading:** A reverse proxy handles TLS handshake overhead and rate-limiting upstream, freeing up Node.js to dedicate 100% of its CPU to block indexing and RPC communication.
> 
> *Best Practice:* Always run Node.js on an internal port (`3001`) as an unprivileged user and put Nginx, Caddy, or Cloudflare in front of it.

---

## ⚙️ Production Daemon Service (Systemd & PM2)

### Running as a Linux Systemd Service

1. Open [`global-crypto-explorer.service`](file:///home/da1712/gspc-explorer/global-crypto-explorer.service) and update `User` and `WorkingDirectory` with your system path:
   ```ini
   [Unit]
   Description=Global Crypto Explorer Daemon Service
   After=network.target

   [Service]
   Type=simple
   User=ubuntu
   WorkingDirectory=/var/www/global-crypto-explorer
   ExecStart=/usr/bin/node src/server.js
   Restart=always
   RestartSec=5
   Environment=NODE_ENV=production

   [Install]
   WantedBy=multi-user.target
   ```
2. Enable and start the service:
   ```bash
   sudo cp global-crypto-explorer.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable global-crypto-explorer
   sudo systemctl start global-crypto-explorer
   ```
3. Check status:
   ```bash
   sudo systemctl status global-crypto-explorer
   ```

### Running with PM2
```bash
npm install -g pm2
pm2 start src/server.js --name "global-crypto-explorer"
pm2 save
pm2 startup
```

---

## 📡 REST API Reference

All endpoints return JSON or text and are accessible from `/ext/...` and `/api/...`:

| Endpoint | Method | Description |
|---|---|---|
| `/api/stats` | GET | Real-time network statistics (blocks, supply, difficulty, hashrate, peers) |
| `/api/charts?days=30` | GET | Historical daily stats for transactions, difficulty, hashrate, and blocks |
| `/ext/getmoneysupply` | GET | Current circulating coin supply (plain text) |
| `/ext/getblockcount` | GET | Current highest block height |
| `/ext/getdifficulty` | GET | Current network mining difficulty |
| `/ext/getconnectioncount` | GET | Count of connected peer nodes |
| `/ext/getblockhash/:height` | GET | Returns block hash for given height |
| `/ext/getblock/:hash` | GET | Full block details with transaction list |
| `/ext/getrawtransaction/:txid` | GET | Decoded raw transaction object |
| `/ext/getbalance/:address` | GET | Spendable balance for address |
| `/ext/getaddress/:address` | GET | Full address balance, received, sent, and tx list |
| `/ext/getlasttxs/:min/:offset/:limit` | GET | Recent transactions above a minimum amount |
| `/ext/getmasternodelist` | GET | Complete list of active network masternodes |
| `/ext/getsummary` | GET | Comprehensive market and network summary object |

Visit `/info` in your browser for the full interactive API documentation.

---

---

## 🏢 Developed By & Ecosystem Platforms

**Global Crypto Explorer** is proudly developed and maintained by **[Global Ads Media, LLC](https://globaladsmedia.us)** in collaboration with the **[GSP Coin Team](https://gspcoin.us)**.

Explore our ecosystem of platforms and digital services:

### 🌟 [Global Ads Media, LLC](https://globaladsmedia.us)
> **Premium Advertising Network & Comprehensive Digital Growth Solutions**
>
> [Global Ads Media, LLC](https://globaladsmedia.us) is an international digital advertising network and technology firm providing innovative ad formats, high-yield monetization for web publishers, programmatic advertising solutions, and advanced audience targeting for brands and media buyers worldwide.
>
> 🔗 **Website:** [https://globaladsmedia.us](https://globaladsmedia.us)

---

### 🪙 [GSP Coin (Global Stabilization Protocol)](https://gspcoin.us)
> **Revolutionary Decentralized Cryptocurrency for Global Financial Freedom**
>
> [GSP Coin (GSPC)](https://gspcoin.us) is a next-generation proof-of-stake / masternode cryptocurrency engineered for global stabilization, transparent on-chain transactions, micro-rewards, and borderless peer-to-peer digital payments. Built for speed, security, and true financial independence.
>
> 🔗 **Website:** [https://gspcoin.us](https://gspcoin.us)

---

### ☁️ [1 Dollar Cloud](https://1dollarcloud.com)
> **Ultra-Affordable Web Hosting, Cloud VPS & Domain Services**
>
> [1 Dollar Cloud](https://1dollarcloud.com) makes enterprise-grade web hosting accessible to everyone, starting at just $1/month. Offering ultra-fast NVMe SSD shared hosting, scalable Cloud VPS, dedicated bare-metal servers, domain registrations, SSL certificates, and 24/7 expert customer support.
>
> 🔗 **Website:** [https://1dollarcloud.com](https://1dollarcloud.com)

---

### 🔗 [1url.my](https://1url.my)
> **100% Free URL Shortener, Custom Branded Links & Analytics**
>
> [1url.my](https://1url.my) is a blazing-fast, privacy-conscious URL shortening service. It empowers creators, marketers, and developers to create clean, trackable short links instantly with custom branded aliases, password protection, link expiration timers, instant QR codes, and in-depth click analytics—completely free with zero ads and zero subscriptions.
>
> 🔗 **Website:** [https://1url.my](https://1url.my)

---

## 📄 License

This project is open-source and licensed under the **MIT License**. You are free to use, customize, and deploy it for any cryptocurrency project.
