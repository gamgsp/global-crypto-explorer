const express = require('express');
const path = require('path');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const config = require('./config');
const db = require('./db');

const app = express();

// View engine setup
app.set('views', path.join(__dirname, '../views'));
app.set('view engine', 'ejs');

// Core Middlewares
app.use(cors());
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// Global template variables middleware
app.use((req, res, next) => {
  const conf = config.getConfig();
  res.locals.coin = conf.coin;
  res.locals.settings = conf;
  res.locals.adminSlug = conf.adminSlug;
  res.locals.appName = conf.appName;
  next();
});

// Setup redirection middleware (if unconfigured, redirect to /setup)
app.use((req, res, next) => {
  const conf = config.getConfig();
  if (!conf.isConfigured) {
    if (
      req.path !== '/setup' &&
      !req.path.startsWith('/public') &&
      !req.path.startsWith('/css') &&
      !req.path.startsWith('/js') &&
      !req.path.startsWith('/images') &&
      !req.path.startsWith('/img') &&
      !req.path.startsWith('/favicon')
    ) {
      return res.redirect('/setup');
    }
  }
  next();
});

// Mount Routes
const apiRoutes = require('./routes/api');
const extRoutes = require('./routes/ext');
const uiRoutes = require('./routes/ui');
const adminRoutes = require('./routes/admin');
const { startIndexer } = require('./indexer');

// Start background indexer
startIndexer();

// Explicit /setup route
app.use('/setup', (req, res, next) => {
  req.url = '/setup' + req.url;
  return adminRoutes(req, res, next);
});

// Dynamic admin URL slug routing (e.g., /gamus, /admin, etc.)
app.use((req, res, next) => {
  const conf = config.getConfig();
  const adminSlug = conf.adminSlug || 'admin';
  if (req.path === `/${adminSlug}` || req.path.startsWith(`/${adminSlug}/`)) {
    const remainder = req.url.slice(`/${adminSlug}`.length);
    req.url = remainder.startsWith('/') ? remainder : ('/' + remainder);
    return adminRoutes(req, res, next);
  }
  next();
});

app.use('/api', apiRoutes);
app.use('/ext', extRoutes);
app.use('/', uiRoutes);

// Global 404 handler
app.use((req, res) => {
  const conf = config.getConfig();
  res.status(404).render('error', {
    active: '404',
    coin: conf.coin,
    error: `Page not found: ${req.originalUrl}`,
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('[SERVER ERROR]', err);
  if (res.headersSent) return next(err);
  const conf = config.getConfig();
  res.status(500).render('error', {
    active: '500',
    coin: conf.coin,
    error: err.message || 'Internal Server Error',
  });
});

const conf = config.getConfig();
app.listen(conf.port, conf.host, () => {
  console.log(`====================================================`);
  console.log(`🚀 ${conf.appName} Started!`);
  console.log(`📍 Web Interface: http://${conf.host}:${conf.port}`);
  console.log(`📍 Admin Panel:   http://${conf.host}:${conf.port}/${conf.adminSlug}`);
  console.log(`📍 API Endpoints:  http://${conf.host}:${conf.port}/info`);
  console.log(`🔗 Connected RPC:  http://${conf.rpc.host}:${conf.rpc.port}`);
  console.log(`====================================================`);
});
