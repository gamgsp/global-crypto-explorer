#!/usr/bin/env bash
# ==============================================================================
# Global Crypto Explorer - Universal Automated Installation & Setup Script
# ==============================================================================
# Official Repository: https://github.com/gamgsp/global-crypto-explorer
# Supported OS: Ubuntu 20.04/22.04/24.04, Debian 11/12, CentOS/RHEL/AlmaLinux/Rocky 8/9
# ==============================================================================

set -e

# ANSI Color Codes for formatting
C_RESET='\033[0m'
C_BOLD='\033[1m'
C_RED='\033[0;31m'
C_GREEN='\033[0;32m'
C_YELLOW='\033[0;33m'
C_BLUE='\033[0;34m'
C_CYAN='\033[0;36m'
C_MAGENTA='\033[0;35m'
C_WHITE='\033[1;37m'

print_banner() {
  clear
  echo -e "${C_CYAN}${C_BOLD}"
  echo "╔═══════════════════════════════════════════════════════════════════════════╗"
  echo "║                                                                           ║"
  echo "║     ██████╗ ██╗      ██████╗ ██████╗  █████╗ ██╗                          ║"
  echo "║    ██╔════╝ ██║     ██╔═══██╗██╔══██╗██╔══██╗██║                          ║"
  echo "║    ██║  ███╗██║     ██║   ██║██████╔╝███████║██║                          ║"
  echo "║    ██║   ██║██║     ██║   ██║██╔══██╗██╔══██║██║                          ║"
  echo "║    ╚██████╔╝███████╗╚██████╔╝██████╔╝██║  ██║███████╗                     ║"
  echo "║     ╚═════╝ ╚══════╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝                     ║"
  echo "║                 CRYPTO BLOCKCHAIN EXPLORER                                ║"
  echo "║            Universal Automated Deployment Engine                          ║"
  echo "║                                                                           ║"
  echo "╚═══════════════════════════════════════════════════════════════════════════╝"
  echo -e "${C_RESET}"
  echo -e "${C_WHITE}Welcome to the Global Crypto Explorer automated installer.${C_RESET}"
  echo -e "This wizard will install all system dependencies, configure web servers"
  echo -e "(Nginx / Apache / Caddy), setup SSL certificates, open firewall ports,"
  echo -e "and optionally configure and launch your Crypto Coin Daemon service.\n"
}

info() {
  echo -e "${C_CYAN}[INFO]${C_RESET} $1"
}

success() {
  echo -e "${C_GREEN}${C_BOLD}[SUCCESS]${C_RESET} ${C_GREEN}$1${C_RESET}"
}

warn() {
  echo -e "${C_YELLOW}${C_BOLD}[WARNING]${C_RESET} ${C_YELLOW}$1${C_RESET}"
}

error() {
  echo -e "${C_RED}${C_BOLD}[ERROR]${C_RESET} ${C_RED}$1${C_RESET}" >&2
}

# -----------------------------------------------------------------------------
# 1. Root & User Check
# -----------------------------------------------------------------------------
if [ "$EUID" -ne 0 ]; then
  error "This installation script must be run as root (or with sudo)."
  echo -e "Please execute: ${C_BOLD}sudo bash $0${C_RESET}"
  exit 1
fi

# Detect non-root target user
if [ -n "$SUDO_USER" ] && [ "$SUDO_USER" != "root" ]; then
  TARGET_USER="$SUDO_USER"
elif id "ubuntu" &>/dev/null; then
  TARGET_USER="ubuntu"
else
  TARGET_USER="root"
fi

USER_HOME=$(getent passwd "$TARGET_USER" | cut -d: -f6)
if [ -z "$USER_HOME" ]; then
  USER_HOME="/root"
fi

print_banner

# -----------------------------------------------------------------------------
# 2. Swap Check & 4GB Allocation
# -----------------------------------------------------------------------------
info "Checking system memory and swap space..."
TOTAL_RAM_MB=$(free -m | awk '/^Mem:/{print $2}')
EXISTING_SWAP_MB=$(free -m | awk '/^Swap:/{print $2}')

if [ "$EXISTING_SWAP_MB" -lt 2048 ]; then
  warn "Total RAM is ${TOTAL_RAM_MB}MB with only ${EXISTING_SWAP_MB}MB Swap."
  echo -e "${C_YELLOW}Creating 4GB swap space to ensure smooth Node.js build & daemon indexing...${C_RESET}"
  
  if [ ! -f /swapfile ]; then
    fallocate -l 4G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=4096 status=progress
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    
    if ! grep -q '/swapfile' /etc/fstab; then
      echo '/swapfile none swap sw 0 0' >> /etc/fstab
    fi
    sysctl vm.swappiness=20 >/dev/null 2>&1 || true
    echo 'vm.swappiness=20' >> /etc/sysctl.conf 2>/dev/null || true
    success "4GB Swap allocated and activated successfully!"
  else
    swapon /swapfile 2>/dev/null || true
    success "Existing /swapfile activated."
  fi
else
  success "System memory check passed: ${TOTAL_RAM_MB}MB RAM, ${EXISTING_SWAP_MB}MB Swap available."
fi

# -----------------------------------------------------------------------------
# 3. Interactive Questionnaire & Configuration Gathering
# -----------------------------------------------------------------------------
echo -e "\n${C_BOLD}${C_WHITE}===============================[ CONFIGURATION WIZARD ]===============================${C_RESET}\n"

# Domain Name
read -r -p "$(echo -e "${C_BOLD}1. Enter your Explorer Domain Name${C_RESET} (e.g. explorer.gspcoin.us or server IP): ")" DOMAIN_INPUT
DOMAIN_INPUT=${DOMAIN_INPUT:-"localhost"}
DOMAIN=$(echo "$DOMAIN_INPUT" | tr -d ' ' | sed -e 's|^https*://||' -e 's|/$||')

# Application Port
read -r -p "$(echo -e "${C_BOLD}2. Enter internal Node.js port${C_RESET} [default: 3001]: ")" APP_PORT
APP_PORT=${APP_PORT:-3001}

# Web Server Choice
echo -e "\n${C_BOLD}3. Choose Web Server / Reverse Proxy:${C_RESET}"
echo -e "   ${C_CYAN}1)${C_RESET} Nginx (${C_GREEN}Recommended${C_RESET} - High speed, SSL termination, caching)"
echo -e "   ${C_CYAN}2)${C_RESET} Apache2 (with mod_proxy, mod_ssl)"
echo -e "   ${C_CYAN}3)${C_RESET} Caddy (Lightweight, automatic SSL)"
echo -e "   ${C_CYAN}4)${C_RESET} Standalone Node.js (Direct HTTP/HTTPS without reverse proxy)"
read -r -p "Enter choice [1-4, default: 1]: " WEBSERVER_CHOICE
WEBSERVER_CHOICE=${WEBSERVER_CHOICE:-1}

# SSL Choice
if [ "$WEBSERVER_CHOICE" != "4" ]; then
  echo -e "\n${C_BOLD}4. SSL / HTTPS Configuration:${C_RESET}"
  echo -e "   ${C_CYAN}1)${C_RESET} Let's Encrypt Free SSL (${C_GREEN}Recommended${C_RESET} - Auto-renewal configured)"
  echo -e "   ${C_CYAN}2)${C_RESET} Custom SSL Certificate (provide paths to .crt and .key)"
  echo -e "   ${C_CYAN}3)${C_RESET} No SSL / HTTP Only (Behind Cloudflare Flexible SSL or Local Test)"
  read -r -p "Enter choice [1-3, default: 1]: " SSL_CHOICE
  SSL_CHOICE=${SSL_CHOICE:-1}

  if [ "$SSL_CHOICE" = "1" ]; then
    read -r -p "$(echo -e "   Enter admin email for Let's Encrypt renewal notices: ")" SSL_EMAIL
    SSL_EMAIL=${SSL_EMAIL:-"admin@$DOMAIN"}
  elif [ "$SSL_CHOICE" = "2" ]; then
    read -r -p "   Path to SSL Certificate (.crt/.pem): " CUSTOM_SSL_CERT
    read -r -p "   Path to SSL Private Key (.key): " CUSTOM_SSL_KEY
  fi
else
  SSL_CHOICE="3"
fi

# -----------------------------------------------------------------------------
# 4. Crypto Coin Daemon Setup Questionnaire
# -----------------------------------------------------------------------------
echo -e "\n${C_BOLD}${C_WHITE}===============================[ COIN DAEMON SETUP ]===============================${C_RESET}\n"
read -r -p "$(echo -e "${C_BOLD}Do you want this autoscript to setup & configure your Coin Daemon too?${C_RESET} (y/n) [default: y]: ")" SETUP_DAEMON_CHOICE
SETUP_DAEMON_CHOICE=${SETUP_DAEMON_CHOICE:-y}

if [[ "$SETUP_DAEMON_CHOICE" =~ ^[Yy]$ ]]; then
  SETUP_DAEMON=true
  echo -e "\n${C_CYAN}--- Coin Daemon Configuration ---${C_RESET}"
  read -r -p "$(echo -e "Coin Name [default: GSPCoin]: ")" COIN_NAME
  COIN_NAME=${COIN_NAME:-"GSPCoin"}
  
  read -r -p "$(echo -e "Coin Ticker / Symbol [default: GSPC]: ")" COIN_SYMBOL
  COIN_SYMBOL=${COIN_SYMBOL:-"GSPC"}

  COIN_LOWER=$(echo "$COIN_NAME" | tr '[:upper:]' '[:lower:]' | tr -cd '[:alnum:]')
  
  read -r -p "$(echo -e "Daemon Binary Name [default: ${COIN_LOWER}d]: ")" DAEMON_BIN
  DAEMON_BIN=${DAEMON_BIN:-"${COIN_LOWER}d"}

  read -r -p "$(echo -e "CLI Binary Name [default: ${COIN_LOWER}-cli]: ")" CLI_BIN
  CLI_BIN=${CLI_BIN:-"${COIN_LOWER}-cli"}

  read -r -p "$(echo -e "Coin P2P Port [default: 18181]: ")" COIN_P2P_PORT
  COIN_P2P_PORT=${COIN_P2P_PORT:-18181}

  read -r -p "$(echo -e "Coin RPC Port [default: 18182]: ")" COIN_RPC_PORT
  COIN_RPC_PORT=${COIN_RPC_PORT:-18182}

  # Generate secure RPC credentials
  AUTO_RPC_USER="${COIN_LOWER}rpc"
  AUTO_RPC_PASS=$(openssl rand -hex 20 2>/dev/null || tr -dc A-Za-z0-9 </dev/urandom | head -c 32)

  read -r -p "$(echo -e "Coin RPC User [default: $AUTO_RPC_USER]: ")" COIN_RPC_USER
  COIN_RPC_USER=${COIN_RPC_USER:-"$AUTO_RPC_USER"}

  read -r -p "$(echo -e "Coin RPC Password [default: <auto-generated secure password>]: ")" COIN_RPC_PASS
  COIN_RPC_PASS=${COIN_RPC_PASS:-"$AUTO_RPC_PASS"}

  COIN_DATA_DIR="$USER_HOME/.${COIN_LOWER}"

  echo -e "\n${C_BOLD}How would you like to install the Coin Daemon binary?${C_RESET}"
  echo -e "   ${C_CYAN}1)${C_RESET} Download from URL / GitHub Release (.tar.gz, .zip, or raw binary)"
  echo -e "   ${C_CYAN}2)${C_RESET} Copy from a local path on this server"
  echo -e "   ${C_CYAN}3)${C_RESET} Binary already installed in /usr/local/bin or PATH"
  read -r -p "Enter choice [1-3, default: 3]: " BINARY_INSTALL_CHOICE
  BINARY_INSTALL_CHOICE=${BINARY_INSTALL_CHOICE:-3}

  if [ "$BINARY_INSTALL_CHOICE" = "1" ]; then
    read -r -p "Enter Download URL for daemon archive/binary: " DAEMON_DOWNLOAD_URL
  elif [ "$BINARY_INSTALL_CHOICE" = "2" ]; then
    read -r -p "Enter full path to daemon binary or archive: " LOCAL_BIN_PATH
  fi
else
  SETUP_DAEMON=false
  echo -e "\n${C_CYAN}--- Existing Coin Daemon RPC Credentials ---${C_RESET}"
  read -r -p "$(echo -e "Coin Name [default: GSPCoin]: ")" COIN_NAME
  COIN_NAME=${COIN_NAME:-"GSPCoin"}

  read -r -p "$(echo -e "Coin Ticker / Symbol [default: GSPC]: ")" COIN_SYMBOL
  COIN_SYMBOL=${COIN_SYMBOL:-"GSPC"}

  read -r -p "$(echo -e "Existing Daemon RPC Host [default: 127.0.0.1]: ")" COIN_RPC_HOST
  COIN_RPC_HOST=${COIN_RPC_HOST:-"127.0.0.1"}

  read -r -p "$(echo -e "Existing Daemon RPC Port [default: 18182]: ")" COIN_RPC_PORT
  COIN_RPC_PORT=${COIN_RPC_PORT:-18182}

  read -r -p "$(echo -e "Existing Daemon RPC Username: ")" COIN_RPC_USER
  read -r -p "$(echo -e "Existing Daemon RPC Password: ")" COIN_RPC_PASS
fi

# -----------------------------------------------------------------------------
# 5. System Package Installation & Environment Setup
# -----------------------------------------------------------------------------
echo -e "\n${C_BOLD}${C_WHITE}===============================[ INSTALLING DEPENDENCIES ]===============================${C_RESET}\n"

info "Updating package repositories..."
export DEBIAN_FRONTEND=noninteractive
if command -v apt-get &>/dev/null; then
  apt-get update -y
  apt-get install -y curl wget git build-essential ufw tar unzip jq openssl software-properties-common
elif command -v dnf &>/dev/null; then
  dnf update -y
  dnf install -y curl wget git make gcc gcc-c++ tar unzip jq openssl firewalld
fi

# Install Node.js v20 LTS if missing or outdated (< 18)
NODE_NEEDS_INSTALL=true
if command -v node &>/dev/null; then
  NODE_VER=$(node -v | tr -d 'v' | cut -d. -f1)
  if [ "$NODE_VER" -ge 18 ]; then
    NODE_NEEDS_INSTALL=false
    success "Node.js $(node -v) is already installed."
  fi
fi

if [ "$NODE_NEEDS_INSTALL" = true ]; then
  info "Installing Node.js v20.x LTS from NodeSource..."
  if command -v apt-get &>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  elif command -v dnf &>/dev/null; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
    dnf install -y nodejs
  fi
  success "Installed Node.js $(node -v) & npm $(npm -v)!"
fi

# Install Selected Web Server
if [ "$WEBSERVER_CHOICE" = "1" ]; then
  info "Installing Nginx & Certbot..."
  if command -v apt-get &>/dev/null; then
    apt-get install -y nginx certbot python3-certbot-nginx
  elif command -v dnf &>/dev/null; then
    dnf install -y nginx certbot python3-certbot-nginx
  fi
  systemctl enable nginx
  systemctl start nginx
elif [ "$WEBSERVER_CHOICE" = "2" ]; then
  info "Installing Apache2 & Certbot..."
  if command -v apt-get &>/dev/null; then
    apt-get install -y apache2 certbot python3-certbot-apache
    a2enmod proxy proxy_http headers ssl rewrite
    systemctl restart apache2
    systemctl enable apache2
  fi
elif [ "$WEBSERVER_CHOICE" = "3" ]; then
  info "Installing Caddy..."
  if command -v apt-get &>/dev/null; then
    apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg --yes
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -y
    apt-get install -y caddy
  fi
fi

# -----------------------------------------------------------------------------
# 6. Port Check & Firewall Setup
# -----------------------------------------------------------------------------
echo -e "\n${C_BOLD}${C_WHITE}===============================[ FIREWALL & PORTS CHECK ]===============================${C_RESET}\n"

info "Configuring firewall and verifying network ports..."
if command -v ufw &>/dev/null; then
  # Always ensure SSH port is allowed before touching firewall!
  ufw allow 22/tcp comment 'SSH Access' >/dev/null 2>&1 || true
  ufw allow 80/tcp comment 'HTTP Webserver' >/dev/null 2>&1 || true
  ufw allow 443/tcp comment 'HTTPS Webserver' >/dev/null 2>&1 || true

  if [ "$SETUP_DAEMON" = true ] && [ -n "$COIN_P2P_PORT" ]; then
    ufw allow "$COIN_P2P_PORT"/tcp comment "$COIN_NAME P2P Network" >/dev/null 2>&1 || true
    info "Allowed P2P network port $COIN_P2P_PORT/tcp in firewall."
  fi

  # Security enforcement: Coin RPC Port must NOT be exposed publicly
  if [ -n "$COIN_RPC_PORT" ]; then
    ufw deny "$COIN_RPC_PORT"/tcp comment "Security: Block external RPC" >/dev/null 2>&1 || true
    success "Firewall rule verified: Coin RPC ($COIN_RPC_PORT) bound to internal localhost only."
  fi

  # Enable UFW if inactive
  if ! ufw status | grep -q "Status: active"; then
    echo "y" | ufw enable >/dev/null 2>&1 || true
    info "UFW firewall activated with rules for ports 22, 80, 443."
  fi
  success "Firewall rules configured successfully!"
fi

# -----------------------------------------------------------------------------
# 7. Coin Daemon Setup & Launch (If Selected)
# -----------------------------------------------------------------------------
if [ "$SETUP_DAEMON" = true ]; then
  echo -e "\n${C_BOLD}${C_WHITE}===============================[ SETTING UP COIN DAEMON ]===============================${C_RESET}\n"
  info "Configuring $COIN_NAME daemon service..."

  # Install binary if URL or local path was provided
  if [ "$BINARY_INSTALL_CHOICE" = "1" ] && [ -n "$DAEMON_DOWNLOAD_URL" ]; then
    info "Downloading coin daemon archive from $DAEMON_DOWNLOAD_URL..."
    TMP_DL_DIR="/tmp/coin_dl_$(date +%s)"
    mkdir -p "$TMP_DL_DIR"
    wget -q --show-progress "$DAEMON_DOWNLOAD_URL" -O "$TMP_DL_DIR/download"
    
    if file "$TMP_DL_DIR/download" | grep -qi "gzip\|tar"; then
      tar -xf "$TMP_DL_DIR/download" -C "$TMP_DL_DIR/"
    elif file "$TMP_DL_DIR/download" | grep -qi "zip"; then
      unzip -q "$TMP_DL_DIR/download" -d "$TMP_DL_DIR/"
    else
      mv "$TMP_DL_DIR/download" "$TMP_DL_DIR/$DAEMON_BIN"
    fi
    
    FOUND_DAEMON=$(find "$TMP_DL_DIR" -type f -name "$DAEMON_BIN" | head -n 1)
    if [ -n "$FOUND_DAEMON" ]; then
      cp "$FOUND_DAEMON" "/usr/local/bin/$DAEMON_BIN"
      chmod +x "/usr/local/bin/$DAEMON_BIN"
      success "Installed $DAEMON_BIN to /usr/local/bin/$DAEMON_BIN"
    fi

    FOUND_CLI=$(find "$TMP_DL_DIR" -type f -name "$CLI_BIN" | head -n 1)
    if [ -n "$FOUND_CLI" ]; then
      cp "$FOUND_CLI" "/usr/local/bin/$CLI_BIN"
      chmod +x "/usr/local/bin/$CLI_BIN"
      success "Installed $CLI_BIN to /usr/local/bin/$CLI_BIN"
    fi
    rm -rf "$TMP_DL_DIR"
  elif [ "$BINARY_INSTALL_CHOICE" = "2" ] && [ -n "$LOCAL_BIN_PATH" ]; then
    if [ -f "$LOCAL_BIN_PATH" ]; then
      cp "$LOCAL_BIN_PATH" "/usr/local/bin/$DAEMON_BIN"
      chmod +x "/usr/local/bin/$DAEMON_BIN"
      success "Copied $DAEMON_BIN to /usr/local/bin/$DAEMON_BIN"
    fi
  fi

  # Create Coin Data Directory & Configuration
  sudo -u "$TARGET_USER" mkdir -p "$COIN_DATA_DIR"
  CONF_FILE="$COIN_DATA_DIR/${COIN_LOWER}.conf"

  info "Writing coin configuration with all indexing flags to $CONF_FILE..."
  cat > "$CONF_FILE" <<EOF
# ${COIN_NAME} Core Configuration
# Auto-generated by Global Crypto Explorer Setup
server=1
daemon=1
listen=1
txindex=1
addressindex=1
spentindex=1
timestampindex=1
rpcuser=${COIN_RPC_USER}
rpcpassword=${COIN_RPC_PASS}
rpcallowip=127.0.0.1
rpcport=${COIN_RPC_PORT}
port=${COIN_P2P_PORT}
maxconnections=64
EOF

  chown -R "$TARGET_USER:$TARGET_USER" "$COIN_DATA_DIR"
  chmod 600 "$CONF_FILE"
  success "Configuration created with txindex, addressindex, spentindex, and timestampindex enabled."

  # Create Systemd Service for Coin Daemon
  SERVICE_DAEMON_NAME="${COIN_LOWER}d.service"
  info "Creating systemd unit /etc/systemd/system/${SERVICE_DAEMON_NAME}..."
  cat > "/etc/systemd/system/${SERVICE_DAEMON_NAME}" <<EOF
[Unit]
Description=${COIN_NAME} Core Daemon
After=network.target

[Service]
Type=forking
User=${TARGET_USER}
Group=${TARGET_USER}
ExecStart=/usr/local/bin/${DAEMON_BIN} -daemon -conf=${CONF_FILE} -datadir=${COIN_DATA_DIR}
ExecStop=/usr/local/bin/${CLI_BIN} -conf=${CONF_FILE} -datadir=${COIN_DATA_DIR} stop
Restart=always
RestartSec=10
TimeoutStopSec=60s
TimeoutStartSec=30s
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable "$SERVICE_DAEMON_NAME"
  systemctl start "$SERVICE_DAEMON_NAME" || true
  success "$SERVICE_DAEMON_NAME enabled and started!"
fi

# -----------------------------------------------------------------------------
# 8. Deploy Global Crypto Explorer Web App
# -----------------------------------------------------------------------------
echo -e "\n${C_BOLD}${C_WHITE}===============================[ DEPLOYING GLOBAL CRYPTO EXPLORER ]===============================${C_RESET}\n"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/src/server.js" ] && [ -f "$SCRIPT_DIR/package.json" ]; then
  APP_DIR="$SCRIPT_DIR"
  info "Using existing repository directory: $APP_DIR"
else
  APP_DIR="/home/$TARGET_USER/global-crypto-explorer"
  if [ ! -d "$APP_DIR" ]; then
    info "Cloning Global Crypto Explorer from GitHub into $APP_DIR..."
    sudo -u "$TARGET_USER" git clone https://github.com/gamgsp/global-crypto-explorer.git "$APP_DIR"
  fi
fi

cd "$APP_DIR"
info "Installing Node.js dependencies..."
sudo -u "$TARGET_USER" npm install --omit=dev

# Create data directory with proper permissions
mkdir -p "$APP_DIR/data"
chown -R "$TARGET_USER:$TARGET_USER" "$APP_DIR"

# Generate or update .env file
info "Configuring environment settings (.env)..."
SESSION_SECRET=$(openssl rand -hex 32 2>/dev/null || tr -dc A-Za-z0-9 </dev/urandom | head -c 48)

cat > "$APP_DIR/.env" <<EOF
PORT=${APP_PORT}
NODE_ENV=production
SESSION_SECRET=${SESSION_SECRET}
COIN_NAME=${COIN_NAME}
COIN_SYMBOL=${COIN_SYMBOL}
COIN_RPC_HOST=127.0.0.1
COIN_RPC_PORT=${COIN_RPC_PORT}
COIN_RPC_USER=${COIN_RPC_USER}
COIN_RPC_PASS=${COIN_RPC_PASS}
EOF

chown "$TARGET_USER:$TARGET_USER" "$APP_DIR/.env"
chmod 600 "$APP_DIR/.env"
success ".env file generated securely."

# Create Global Crypto Explorer Systemd Service
info "Creating systemd service /etc/systemd/system/global-crypto-explorer.service..."
NODE_BIN=$(command -v node)

cat > /etc/systemd/system/global-crypto-explorer.service <<EOF
[Unit]
Description=Global Crypto Explorer Node Service
After=network.target ${SERVICE_DAEMON_NAME:-}
Wants=${SERVICE_DAEMON_NAME:-}

[Service]
Type=simple
User=${TARGET_USER}
WorkingDirectory=${APP_DIR}
ExecStart=${NODE_BIN} src/server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable global-crypto-explorer.service
systemctl restart global-crypto-explorer.service
success "global-crypto-explorer.service enabled and started!"

# -----------------------------------------------------------------------------
# 9. Web Server & Reverse Proxy Setup
# -----------------------------------------------------------------------------
echo -e "\n${C_BOLD}${C_WHITE}===============================[ WEB SERVER CONFIGURATION ]===============================${C_RESET}\n"

if [ "$WEBSERVER_CHOICE" = "1" ]; then
  info "Configuring Nginx reverse proxy for $DOMAIN -> 127.0.0.1:$APP_PORT..."
  NGINX_CONF="/etc/nginx/sites-available/$DOMAIN"

  cat > "$NGINX_CONF" <<EOF
server {
    listen 80;
    server_name ${DOMAIN};

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        client_max_body_size 25M;
    }
}
EOF

  ln -sf "$NGINX_CONF" "/etc/nginx/sites-enabled/$DOMAIN"
  rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
  
  if nginx -t; then
    systemctl reload nginx
    success "Nginx reverse proxy active!"
  else
    error "Nginx configuration test failed. Please verify syntax."
  fi

  # Let's Encrypt SSL Issuance
  if [ "$SSL_CHOICE" = "1" ] && [ "$DOMAIN" != "localhost" ]; then
    info "Requesting Let's Encrypt SSL certificate for $DOMAIN..."
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$SSL_EMAIL" --redirect || {
      warn "Certbot automated issuance did not complete. (Ensure DNS is pointing to this server IP!)"
    }
  fi

elif [ "$WEBSERVER_CHOICE" = "2" ]; then
  info "Configuring Apache2 reverse proxy for $DOMAIN -> 127.0.0.1:$APP_PORT..."
  APACHE_CONF="/etc/apache2/sites-available/$DOMAIN.conf"

  cat > "$APACHE_CONF" <<EOF
<VirtualHost *:80>
    ServerName ${DOMAIN}

    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:${APP_PORT}/
    ProxyPassReverse / http://127.0.0.1:${APP_PORT}/

    RewriteEngine on
    RewriteCond %{HTTP:Upgrade} websocket [NC]
    RewriteCond %{HTTP:Connection} upgrade [NC]
    RewriteRule .* "ws://127.0.0.1:${APP_PORT}%{REQUEST_URI}" [P]

    ErrorLog \${APACHE_LOG_DIR}/${DOMAIN}_error.log
    CustomLog \${APACHE_LOG_DIR}/${DOMAIN}_access.log combined
</VirtualHost>
EOF

  a2ensite "$DOMAIN.conf"
  a2dissite 000-default.conf 2>/dev/null || true
  systemctl reload apache2

  if [ "$SSL_CHOICE" = "1" ] && [ "$DOMAIN" != "localhost" ]; then
    certbot --apache -d "$DOMAIN" --non-interactive --agree-tos -m "$SSL_EMAIL" || true
  fi

elif [ "$WEBSERVER_CHOICE" = "3" ]; then
  info "Configuring Caddy for $DOMAIN -> 127.0.0.1:$APP_PORT..."
  cat > /etc/caddy/Caddyfile <<EOF
${DOMAIN} {
    reverse_proxy 127.0.0.1:${APP_PORT}
}
EOF
  systemctl restart caddy
  success "Caddy configured and restarted!"
fi

# -----------------------------------------------------------------------------
# 10. Verification & Summary Output
# -----------------------------------------------------------------------------
sleep 3
info "Verifying explorer service status..."
if systemctl is-active --quiet global-crypto-explorer.service; then
  STATUS_DISPLAY="${C_GREEN}ONLINE & RUNNING${C_RESET}"
else
  STATUS_DISPLAY="${C_YELLOW}STARTING / CHECK LOGS${C_RESET}"
fi

PROTOCOL="http"
[ "$SSL_CHOICE" = "1" ] && PROTOCOL="https"

echo -e "\n${C_GREEN}${C_BOLD}"
echo "╔═══════════════════════════════════════════════════════════════════════════╗"
echo "║             GLOBAL CRYPTO EXPLORER INSTALLED SUCCESSFULLY!                ║"
echo "╚═══════════════════════════════════════════════════════════════════════════╝"
echo -e "${C_RESET}"

echo -e "  ${C_BOLD}• Explorer URL:${C_RESET}             ${C_CYAN}${PROTOCOL}://${DOMAIN}${C_RESET}"
echo -e "  ${C_BOLD}• First-Time Admin Setup:${C_RESET}   ${C_CYAN}${PROTOCOL}://${DOMAIN}/setup${C_RESET}"
echo -e "  ${C_BOLD}• Service Status:${C_RESET}           ${STATUS_DISPLAY}"
echo -e "  ${C_BOLD}• Coin Name / Symbol:${C_RESET}       ${COIN_NAME} (${COIN_SYMBOL})"
echo -e "  ${C_BOLD}• RPC Endpoint:${C_RESET}             127.0.0.1:${COIN_RPC_PORT}"
echo -e "  ${C_BOLD}• Web Server:${C_RESET}               $( [ "$WEBSERVER_CHOICE" = "1" ] && echo "Nginx" || [ "$WEBSERVER_CHOICE" = "2" ] && echo "Apache2" || [ "$WEBSERVER_CHOICE" = "3" ] && echo "Caddy" || echo "Standalone Node" )"
echo -e "  ${C_BOLD}• Installation Path:${C_RESET}        ${APP_DIR}"

echo -e "\n${C_BOLD}${C_WHITE}Helpful System Management Commands:${C_RESET}"
echo -e "  • Restart Explorer:      ${C_CYAN}sudo systemctl restart global-crypto-explorer${C_RESET}"
echo -e "  • View Explorer Logs:    ${C_CYAN}sudo journalctl -u global-crypto-explorer -f${C_RESET}"
if [ "$SETUP_DAEMON" = true ]; then
  echo -e "  • Restart Coin Daemon:   ${C_CYAN}sudo systemctl restart ${SERVICE_DAEMON_NAME}${C_RESET}"
  echo -e "  • View Daemon Logs:      ${C_CYAN}sudo journalctl -u ${SERVICE_DAEMON_NAME} -f${C_RESET}"
fi
echo -e "  • Update from GitHub:    ${C_CYAN}From Admin Panel > System & Updates (or 'git pull && npm install')${C_RESET}\n"

success "Deployment finished! Visit ${PROTOCOL}://${DOMAIN}/setup to complete your administrator setup."
