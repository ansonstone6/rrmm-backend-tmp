/**
 * GET /api/admin/dashboard  — platform stats for admin view
 */
import { supabaseAdmin, getUserFromRequest } from '../../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const user = await getUserFromRequest(req);
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

  const [
    { count: activeAuctions },
    { count: pendingReview },
    { count: totalUsers },
    { data: recentTransactions },
    { data: recentBids },
  ] = await Promise.all([
    supabaseAdmin.from('auctions').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    supabaseAdmin.from('auctions').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    supabaseAdmin.from('users').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('transactions').select('*, auctions!auction_id(title)').order('created_at', { ascending: false }).limit(10),
    supabaseAdmin.from('bids').select('amount, created_at').gte('created_at', new Date(Date.now() - 86400000).toISOString()),
  ]);

  const dailyGMV = (recentBids || []).reduce((s, b) => s + parseFloat(b.amount), 0);
  const totalGMV = (recentTransactions || []).reduce((s, t) => s + parseFloat(t.gross_amount), 0);

  return res.status(200).json({
    stats: { activeAuctions, pendingReview, totalUsers, dailyGMV, recentGMV: totalGMV },
    recentTransactions,
  });
}
