/**
 * GET /api/users/earnings
 * Returns photographer earnings summary and transaction history
 */
import { supabaseAdmin, getUserFromRequest } from '../../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  if (user.role !== 'photographer') return res.status(403).json({ error: 'Photographers only' });

  // All completed transactions
  const { data: transactions } = await supabaseAdmin
    .from('transactions')
    .select('*, auctions!auction_id(title, category, emoji:event_tag)')
    .eq('photographer_id', user.id)
    .order('created_at', { ascending: false });

  // Monthly breakdown for chart
  const monthly = {};
  for (const tx of (transactions || [])) {
    if (tx.payout_status !== 'paid') continue;
    const month = tx.created_at.slice(0,7); // "2026-04"
    monthly[month] = (monthly[month] || 0) + parseFloat(tx.photographer_payout);
  }

  // Pending payout
  const pending = (transactions || [])
    .filter(tx => tx.payout_status === 'pending')
    .reduce((s, tx) => s + parseFloat(tx.photographer_payout), 0);

  // Live auctions
  const { data: liveAuctions } = await supabaseAdmin
    .from('auctions').select('id, title, current_bid, status')
    .eq('photographer_id', user.id).eq('status', 'active');

  return res.status(200).json({
    summary: {
      totalEarned: user.total_earned,
      totalSales: user.total_sales,
      pendingPayout: pending,
      avgSaleNet: user.total_sales > 0 ? (user.total_earned / user.total_sales).toFixed(2) : 0,
    },
    monthly,
    transactions,
    liveAuctions,
  });
}
