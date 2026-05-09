/**
 * POST /api/admin/review  — approve or reject pending content
 * GET  /api/admin/review  — list all pending auctions for review
 */
import { supabaseAdmin, getUserFromRequest } from '../../lib/supabase.js';
import { activateAuction } from '../../lib/auction-engine.js';
import { notifyContentApproved, notifyContentRejected } from '../../lib/notifications.js';

export default async function handler(req, res) {
  const user = await getUserFromRequest(req);
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

  if (req.method === 'GET') {
    const { data } = await supabaseAdmin
      .from('auctions')
      .select('*, users!photographer_id(handle, display_name, email, total_sales, verified)')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    return res.status(200).json({ pending: data, count: data?.length });
  }

  if (req.method === 'POST') {
    const { auctionId, decision, notes } = req.body;
    if (!['approved','rejected','flagged'].includes(decision)) return res.status(400).json({ error: 'Invalid decision' });

    // Log the review
    await supabaseAdmin.from('content_reviews').insert({
      auction_id: auctionId, reviewer_id: user.id, decision, notes,
    });

    const { data: auction } = await supabaseAdmin.from('auctions').select('photographer_id, title').eq('id', auctionId).single();

    if (decision === 'approved') {
      await activateAuction(auctionId);
      await notifyContentApproved({ photographerId: auction.photographer_id, auctionId });
      return res.status(200).json({ success: true, message: 'Auction activated and buyers notified' });
    } else {
      await supabaseAdmin.from('auctions').update({ status: 'cancelled' }).eq('id', auctionId);
      await notifyContentRejected({ photographerId: auction.photographer_id, auctionId, reason: notes || 'Content did not meet platform standards' });
      return res.status(200).json({ success: true, message: 'Auction rejected and photographer notified' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
