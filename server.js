// server.js — RRMM API Server
require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const rateLimit  = require('express-rate-limit');
const routes     = require('./api/routes');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Security ─────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: [process.env.NEXT_PUBLIC_APP_URL, 'http://localhost:3000'],
  credentials: true
}));

// ── Rate limiting ─────────────────────────────────────────────
const limiter = rateLimit({ windowMs: 60 * 1000, max: 120, message: { error: 'Too many requests' } });
const bidLimiter = rateLimit({ windowMs: 10 * 1000, max: 5, message: { error: 'Bidding too fast — wait a moment' } });

app.use('/api', limiter);
app.use('/api/auctions/:id/bid', bidLimiter);

// ── Logging ───────────────────────────────────────────────────
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ── Body parsing (skip for Stripe webhook raw body) ───────────
app.use((req, res, next) => {
  if (req.originalUrl === '/api/stripe/webhook') return next();
  express.json({ limit: '10mb' })(req, res, next);
});

// ── Health check ──────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'RRMM API', timestamp: new Date().toISOString() }));

// ── Routes ────────────────────────────────────────────────────
app.use('/api', routes);

// ── 404 ───────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: `Route ${req.method} ${req.path} not found` }));

// ── Global error handler ──────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message });
});

app.listen(PORT, () => {
  console.log(`\n🚀 RRMM API running on port ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Health: http://localhost:${PORT}/health\n`);
});

module.exports = app;
