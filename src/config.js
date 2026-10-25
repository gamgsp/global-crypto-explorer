require('dotenv').config();
const db = require('./db');

function getConfig() {
  const all = db.getAllSettings();
  const coinName = all.coin_name || 'Global Crypto';
  const coinSymbol = all.coin_symbol || 'CRYPTO';

  const envPort = process.env.PORT || '3001';
  const envHost = process.env.HOST || '0.0.0.0';
  const envDomain = process.env.DOMAIN ? process.env.DOMAIN.trim().replace(/\/+$/, '') : '';

  return {
    port: parseInt(envPort, 10),
    host: envHost,
    domain: envDomain,
    appName: all.app_name || 'Global Crypto Explorer',
    isConfigured: all.is_configured === '1' && !!all.admin_password_hash,
    adminSlug: all.admin_slug || 'admin',
    adminName: all.admin_name || 'Administrator',
    adminEmail: all.admin_email || 'admin@example.com',
    coin: {
      name: coinName,
      symbol: coinSymbol,
      decimals: parseInt(all.coin_decimals || '8', 10),
      logo: all.logo_url || '',
      favicon: all.favicon_url || '',
      officialWebsite: all.official_website || '',
    },
    rpc: {
      host: all.rpc_host || process.env.RPC_HOST || '127.0.0.1',
      port: parseInt(all.rpc_port || process.env.RPC_PORT || '9998', 10),
      user: all.rpc_user || process.env.RPC_USER || '',
      password: all.rpc_password || process.env.RPC_PASSWORD || '',
      timeout: parseInt(process.env.RPC_TIMEOUT || '5000', 10),
    },
    features: {
      hasMasternodes: all.has_masternodes !== '0',
      masternodeLabel: all.masternode_label || 'Masternodes',
      hasHeroBanner: all.has_hero_banner !== '0',
    },
    hero: {
      badge: all.hero_badge !== undefined ? all.hero_badge : 'LIVE MAINNET SYNCHRONIZED',
      title: all.hero_title || `${coinName} Next-Gen Block Explorer`,
      subtitle: all.hero_subtitle || 'High-speed, direct-RPC block explorer with real-time blocks, transactions, and on-chain intelligence.',
      image: all.hero_image || '',
    },
    theme: {
      font: all.theme_font || 'Outfit',
      bgType: all.theme_bg_type || 'color',
      bgColor: all.theme_bg_color || '#0b0f19',
      bgImage: all.theme_bg_image || '',
      cardBg: all.theme_card_bg || 'rgba(17, 24, 39, 0.75)',
      cardBorder: all.theme_card_border || 'rgba(255, 255, 255, 0.08)',
      cardRadius: all.theme_card_radius || '14px',
      textPrimary: all.theme_text_primary || '#ffffff',
      textSecondary: all.theme_text_secondary || '#9ca3af',
      accentColor: all.theme_accent_color || '#10b981',
    },
    chart: {
      defaultDays: parseInt(all.chart_default_days || '30', 10),
    },
    footer: {
      text: all.footer_text || 'Global Crypto Explorer © 2026. All rights reserved.',
      links: (() => {
        try { return JSON.parse(all.footer_links_json || '[]'); } catch { return []; }
      })(),
    },
    socialLinks: (() => {
      try { return JSON.parse(all.social_links_json || '[]'); } catch { return []; }
    })(),
    exchanges: (() => {
      try { return JSON.parse(all.exchanges_json || '[]'); } catch { return []; }
    })(),
    analytics: {
      googleTagEnabled: all.google_tag_enabled !== undefined ? all.google_tag_enabled === '1' : !!all.google_tag_id,
      googleTagId: (all.google_tag_id || '').trim(),
      matomoEnabled: all.matomo_enabled !== undefined ? all.matomo_enabled === '1' : !!(all.matomo_url && all.matomo_site_id),
      matomoUrl: (all.matomo_url || '').trim(),
      matomoSiteId: (all.matomo_site_id || '').trim(),
      customHeadTags: all.custom_head_tags || '',
      customBodyTags: all.custom_body_tags || '',
      trackAdminPages: all.track_admin_pages === '1',
    },
    defaults: {
      confirmations: 10,
      txsPerPage: 25,
      maxLastTxs: 100,
      syncIntervalSeconds: parseInt(all.sync_interval_seconds || '60', 10),
    }
  };
}

module.exports = {
  getConfig,
  get port() { return getConfig().port; },
  get host() { return getConfig().host; },
  get domain() { return getConfig().domain; },
  get rpc() { return getConfig().rpc; },
  get coin() { return getConfig().coin; },
  get analytics() { return getConfig().analytics; },
  get defaults() { return getConfig().defaults; },
};
