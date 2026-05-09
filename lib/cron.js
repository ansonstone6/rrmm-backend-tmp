/**
 * RRMM Cron Job
 * Run every minute to close expired auctions
 * Deploy as Vercel Cron or call from external scheduler
 *
 * Vercel cron.json:
 * { "crons": [{ "path": "/api/cron/close-auctions", "schedule": "* * * * *" }] }
 */
import { processExpiredAuctions } from './auction-engine.js';

// For Vercel Cron (as an API route at /api/cron/close-auctions)
export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const results = await processExpiredAuctions();
  console.log(`[CRON] Processed ${results.length} expired auctions:`, results);
  return res.status(200).json({ processed: results.length, results });
}
