/**
 * GET /api/health
 * Lightweight health check. Reads project metadata from package.json
 * so you can verify the deployment is live without needing any third-party
 * credentials (Supabase, Stripe, etc.).
 */
import { readFileSync } from 'fs';
import { join } from 'path';

let pkg;
try {
  pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
} catch (err) {
  pkg = { name: 'unknown', description: 'package.json unreadable', version: '0.0.0' };
}

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    status: 'ok',
    name: pkg.name,
    description: pkg.description,
    version: pkg.version,
    node: process.version,
    region: process.env.VERCEL_REGION || 'local',
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || 'local',
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.round(process.uptime()),
  });
}
