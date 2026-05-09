// cron/auction-closer.js
// Runs every minute. Closes expired auctions and sends 15-min warnings.
// Deploy as a separate process or on Vercel/Railway cron.

const cron = require('node-cron');
require('dotenv').config();

const API_URL     = process.env.API_URL || 'http://localhost:3001';
const ADMIN_SECRET = process.env.ADMIN_SECRET;

async function callCron(endpoint) {
  try {
    const res = await fetch(`${API_URL}/api/cron/${endpoint}`, {
      method:  'POST',
      headers: { 'x-admin-secret': ADMIN_SECRET, 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (data.processed > 0 || data.alerted > 0) {
      console.log(`[${new Date().toISOString()}] ${endpoint}:`, data);
    }
  } catch (err) {
    console.error(`[CRON ERROR] ${endpoint}:`, err.message);
  }
}

// Every minute: close expired auctions + send closing alerts
cron.schedule('* * * * *', async () => {
  await Promise.all([
    callCron('close-auctions'),
    callCron('closing-alerts')
  ]);
});

console.log('✅ RRMM Auction Cron running — checking every minute');
