const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');
const config = require('../config');

// Helper to get auth token hash
function getAuthToken(passwordHash) {
  return crypto.createHmac('sha256', 'global-crypto-secret-key-2026').update(passwordHash).digest('hex');
}

// Auth middleware
function requireAuth(req, res, next) {
  const conf = config.getConfig();
  if (!conf.isConfigured) {
    return res.redirect('/setup');
  }

  const token = req.cookies && req.cookies.admin_token;
  const adminSlug = conf.adminSlug;
  const currentHash = db.getSetting('admin_password_hash', '');

  if (!token || !currentHash || token !== getAuthToken(currentHash)) {
    return res.redirect(`/${adminSlug}/login`);
  }
  next();
}

// ----------------------------------------------------
// 1. First-Run Setup Wizard (/setup)
// ----------------------------------------------------
router.get('/setup', (req, res) => {
  const conf = config.getConfig();
  if (conf.isConfigured) {
    return res.redirect(`/${conf.adminSlug}/login`);
  }

  res.render('admin/setup', {
    active: 'setup',
    error: req.query.error || null,
    settings: conf,
    coin: conf.coin,
  });
});

router.post('/setup', (req, res) => {
  const conf = config.getConfig();
  if (conf.isConfigured) {
    return res.redirect(`/${conf.adminSlug}/login`);
  }

  const {
    admin_name,
    admin_email,
    admin_password,
    admin_password_confirm,
    admin_slug,
    coin_name,
    coin_symbol,
    coin_decimals,
    rpc_host,
    rpc_port,
    rpc_user,
    rpc_password,
    logo_url,
    favicon_url,
    has_masternodes,
    masternode_label,
    hero_badge,
    hero_title,
    hero_subtitle,
    theme_font,
    theme_bg_type,
    theme_bg_color,
    theme_card_bg,
    theme_card_border,
    theme_accent_color,
    footer_text,
  } = req.body;

  if (!admin_password || admin_password.length < 6) {
    return res.redirect('/setup?error=' + encodeURIComponent('Password must be at least 6 characters long.'));
  }

  if (admin_password !== admin_password_confirm) {
    return res.redirect('/setup?error=' + encodeURIComponent('Passwords do not match.'));
  }

  const sanitizedSlug = (admin_slug || 'admin').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!sanitizedSlug) {
    return res.redirect('/setup?error=' + encodeURIComponent('Invalid admin URL slug.'));
  }

  const salt = bcrypt.genSaltSync(10);
  const passwordHash = bcrypt.hashSync(admin_password, salt);

  const newSettings = {
    app_name: 'Global Crypto Explorer',
    is_configured: '1',
    admin_name: admin_name || 'Administrator',
    admin_email: admin_email || 'admin@example.com',
    admin_password_hash: passwordHash,
    admin_slug: sanitizedSlug,
    coin_name: coin_name || 'Global Crypto',
    coin_symbol: (coin_symbol || 'CRYPTO').toUpperCase(),
    coin_decimals: coin_decimals || '8',
    rpc_host: rpc_host || '127.0.0.1',
    rpc_port: rpc_port || '15167',
    rpc_user: rpc_user || 'gspcrpc',
    rpc_password: rpc_password || 'gspcpassword123',
    logo_url: logo_url || '',
    favicon_url: favicon_url || '',
    has_masternodes: has_masternodes === '0' ? '0' : '1',
    masternode_label: masternode_label || 'Smartnodes',
    has_hero_banner: '1',
    hero_badge: hero_badge || 'LIVE MAINNET SYNCHRONIZED',
    hero_title: hero_title || `${coin_name || 'Global Crypto'} Next-Gen Block Explorer`,
    hero_subtitle: hero_subtitle || 'High-speed, direct-RPC block explorer with real-time blocks, transactions, and on-chain intelligence.',
    hero_image: '',
    theme_font: theme_font || 'Outfit',
    theme_bg_type: theme_bg_type || 'color',
    theme_bg_color: theme_bg_color || '#0b0f19',
    theme_bg_image: '',
    theme_card_bg: theme_card_bg || 'rgba(17, 24, 39, 0.75)',
    theme_card_border: theme_card_border || 'rgba(255, 255, 255, 0.08)',
    theme_card_radius: '14px',
    theme_text_primary: '#ffffff',
    theme_text_secondary: '#9ca3af',
    theme_accent_color: theme_accent_color || '#10b981',
    footer_text: footer_text || 'Global Crypto Explorer © 2026. All rights reserved.',
    footer_links_json: JSON.stringify([]),
    social_links_json: JSON.stringify([]),
    exchanges_json: JSON.stringify([]),
  };

  db.updateSettings(newSettings);

  // Set session cookie
  const token = getAuthToken(passwordHash);
  res.cookie('admin_token', token, { httpOnly: true, maxAge: 30 * 24 * 3600 * 1000 });

  res.redirect(`/${sanitizedSlug}`);
});

// ----------------------------------------------------
// 2. Admin Login & Logout
// ----------------------------------------------------
router.get('/login', (req, res) => {
  const conf = config.getConfig();
  if (!conf.isConfigured) return res.redirect('/setup');

  res.render('admin/login', {
    active: 'admin_login',
    adminSlug: conf.adminSlug,
    error: req.query.error || null,
    settings: conf,
    coin: conf.coin,
  });
});

router.post('/login', (req, res) => {
  const conf = config.getConfig();
  const { password } = req.body;
  const hash = db.getSetting('admin_password_hash', '');

  if (!hash || !bcrypt.compareSync(password || '', hash)) {
    return res.redirect(`/${conf.adminSlug}/login?error=` + encodeURIComponent('Invalid password.'));
  }

  const token = getAuthToken(hash);
  res.cookie('admin_token', token, { httpOnly: true, maxAge: 30 * 24 * 3600 * 1000 });
  res.redirect(`/${conf.adminSlug}`);
});

router.get('/logout', (req, res) => {
  res.clearCookie('admin_token');
  res.redirect('/');
});

// ----------------------------------------------------
// 3. Admin Dashboard & Settings Tabs
// ----------------------------------------------------
router.get('/', requireAuth, (req, res) => {
  const conf = config.getConfig();
  res.render('admin/dashboard', {
    active: 'admin_dashboard',
    tab: req.query.tab || 'general',
    message: req.query.msg || null,
    error: req.query.error || null,
    adminSlug: conf.adminSlug,
    settings: conf,
    coin: conf.coin,
  });
});

// Update Coin & RPC Settings
router.post('/update-coin', requireAuth, (req, res) => {
  const conf = config.getConfig();
  const {
    coin_name,
    coin_symbol,
    coin_decimals,
    chart_default_days,
    rpc_host,
    rpc_port,
    rpc_user,
    rpc_password,
    logo_url,
    favicon_url,
    official_website,
  } = req.body;

  db.updateSettings({
    coin_name: coin_name || conf.coin.name,
    coin_symbol: (coin_symbol || conf.coin.symbol).toUpperCase(),
    coin_decimals: coin_decimals || '8',
    chart_default_days: chart_default_days || '15',
    rpc_host: rpc_host || conf.rpc.host,
    rpc_port: rpc_port || conf.rpc.port,
    rpc_user: rpc_user || conf.rpc.user,
    rpc_password: rpc_password || conf.rpc.password,
    logo_url: logo_url || '',
    favicon_url: favicon_url || '',
    official_website: official_website || '',
  });

  res.redirect(`/${conf.adminSlug}?tab=general&msg=` + encodeURIComponent('Coin & Node settings updated successfully!'));
});

// Update Hero Banner
router.post('/update-hero', requireAuth, (req, res) => {
  const conf = config.getConfig();
  const { has_hero_banner, hero_badge, hero_title, hero_subtitle, hero_image } = req.body;

  db.updateSettings({
    has_hero_banner: has_hero_banner === '1' ? '1' : '0',
    hero_badge: hero_badge || '',
    hero_title: hero_title || '',
    hero_subtitle: hero_subtitle || '',
    hero_image: hero_image || '',
  });

  res.redirect(`/${conf.adminSlug}?tab=hero&msg=` + encodeURIComponent('Hero banner updated successfully!'));
});

// Update Masternodes / Smartnodes Toggle
router.post('/update-masternodes', requireAuth, (req, res) => {
  const conf = config.getConfig();
  const { has_masternodes, masternode_label } = req.body;

  db.updateSettings({
    has_masternodes: has_masternodes === '1' ? '1' : '0',
    masternode_label: masternode_label || 'Smartnodes',
  });

  res.redirect(`/${conf.adminSlug}?tab=masternodes&msg=` + encodeURIComponent('Masternode settings updated successfully!'));
});

// Update Theme & Appearance
router.post('/update-theme', requireAuth, (req, res) => {
  const conf = config.getConfig();
  const {
    theme_font,
    theme_bg_type,
    theme_bg_color,
    theme_bg_image,
    theme_card_bg,
    theme_card_border,
    theme_card_radius,
    theme_text_primary,
    theme_text_secondary,
    theme_accent_color,
  } = req.body;

  db.updateSettings({
    theme_font: theme_font || 'Outfit',
    theme_bg_type: theme_bg_type || 'color',
    theme_bg_color: theme_bg_color || '#0b0f19',
    theme_bg_image: theme_bg_image || '',
    theme_card_bg: theme_card_bg || 'rgba(17, 24, 39, 0.75)',
    theme_card_border: theme_card_border || 'rgba(255, 255, 255, 0.08)',
    theme_card_radius: theme_card_radius || '14px',
    theme_text_primary: theme_text_primary || '#ffffff',
    theme_text_secondary: theme_text_secondary || '#9ca3af',
    theme_accent_color: theme_accent_color || '#10b981',
  });

  res.redirect(`/${conf.adminSlug}?tab=theme&msg=` + encodeURIComponent('Theme appearance updated successfully!'));
});

// Update Social & Tracker Links
router.post('/update-socials', requireAuth, (req, res) => {
  const conf = config.getConfig();
  const { platforms, titles, urls } = req.body;

  const links = [];
  if (Array.isArray(platforms)) {
    for (let i = 0; i < platforms.length; i++) {
      if (urls[i] && urls[i].trim().length > 0) {
        links.push({
          platform: platforms[i] || 'custom',
          title: (titles && titles[i]) || platforms[i],
          url: urls[i].trim(),
        });
      }
    }
  } else if (platforms && urls && urls.trim().length > 0) {
    links.push({
      platform: platforms,
      title: titles || platforms,
      url: urls.trim(),
    });
  }

  db.setSetting('social_links_json', JSON.stringify(links));
  res.redirect(`/${conf.adminSlug}?tab=socials&msg=` + encodeURIComponent('Social links updated successfully!'));
});

// Update Listed Exchanges
router.post('/update-exchanges', requireAuth, (req, res) => {
  const conf = config.getConfig();
  const { names, pairs, pair_urls, ticker_urls, actives } = req.body;

  const list = [];
  if (Array.isArray(names)) {
    for (let i = 0; i < names.length; i++) {
      if (names[i] && names[i].trim().length > 0) {
        list.push({
          id: names[i].toLowerCase().replace(/[^a-z0-9]/g, ''),
          name: names[i].trim(),
          pair: (pairs && pairs[i]) ? pairs[i].trim() : `${conf.coin.symbol}/USDT`,
          pair_url: (pair_urls && pair_urls[i]) ? pair_urls[i].trim() : '',
          ticker_url: (ticker_urls && ticker_urls[i]) ? ticker_urls[i].trim() : '',
          active: actives ? (Array.isArray(actives) ? actives.includes(String(i)) : actives === String(i)) : true,
          last_price: 0,
          volume_24h: 0,
        });
      }
    }
  } else if (names && names.trim().length > 0) {
    list.push({
      id: names.toLowerCase().replace(/[^a-z0-9]/g, ''),
      name: names.trim(),
      pair: pairs || `${conf.coin.symbol}/USDT`,
      pair_url: pair_urls || '',
      ticker_url: ticker_urls || '',
      active: true,
      last_price: 0,
      volume_24h: 0,
    });
  }

  db.setSetting('exchanges_json', JSON.stringify(list));
  res.redirect(`/${conf.adminSlug}?tab=exchanges&msg=` + encodeURIComponent('Market exchanges updated successfully!'));
});

// Update Footer Settings & Links
router.post('/update-footer', requireAuth, (req, res) => {
  const conf = config.getConfig();
  const { footer_text, link_titles, link_urls } = req.body;

  const footerLinks = [];
  if (Array.isArray(link_titles)) {
    for (let i = 0; i < link_titles.length; i++) {
      if (link_titles[i] && link_urls[i] && link_urls[i].trim().length > 0) {
        footerLinks.push({
          title: link_titles[i].trim(),
          url: link_urls[i].trim(),
        });
      }
    }
  } else if (link_titles && link_urls && link_urls.trim().length > 0) {
    footerLinks.push({
      title: link_titles.trim(),
      url: link_urls.trim(),
    });
  }

  db.setSetting('footer_text', footer_text || '');
  db.setSetting('footer_links_json', JSON.stringify(footerLinks));

  res.redirect(`/${conf.adminSlug}?tab=footer&msg=` + encodeURIComponent('Footer settings updated successfully!'));
});

// Update Admin Profile & Password & Slug
router.post('/update-profile', requireAuth, (req, res) => {
  const conf = config.getConfig();
  const {
    admin_name,
    admin_email,
    admin_slug,
    current_password,
    new_password,
    new_password_confirm,
  } = req.body;

  const currentHash = db.getSetting('admin_password_hash', '');

  if (!current_password || !bcrypt.compareSync(current_password, currentHash)) {
    return res.redirect(`/${conf.adminSlug}?tab=profile&error=` + encodeURIComponent('Current password is incorrect.'));
  }

  let finalHash = currentHash;
  if (new_password && new_password.length > 0) {
    if (new_password.length < 6) {
      return res.redirect(`/${conf.adminSlug}?tab=profile&error=` + encodeURIComponent('New password must be at least 6 characters.'));
    }
    if (new_password !== new_password_confirm) {
      return res.redirect(`/${conf.adminSlug}?tab=profile&error=` + encodeURIComponent('New passwords do not match.'));
    }
    const salt = bcrypt.genSaltSync(10);
    finalHash = bcrypt.hashSync(new_password, salt);
  }

  let finalSlug = conf.adminSlug;
  if (admin_slug && admin_slug.trim().length > 0) {
    const clean = admin_slug.toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (clean) finalSlug = clean;
  }

  db.updateSettings({
    admin_name: admin_name || conf.adminName,
    admin_email: admin_email || conf.adminEmail,
    admin_slug: finalSlug,
    admin_password_hash: finalHash,
  });

  // Re-issue cookie with new token
  const token = getAuthToken(finalHash);
  res.cookie('admin_token', token, { httpOnly: true, maxAge: 30 * 24 * 3600 * 1000 });

  res.redirect(`/${finalSlug}?tab=profile&msg=` + encodeURIComponent('Profile updated successfully!'));
});

module.exports = router;
