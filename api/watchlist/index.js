/**
 * GET    /api/watchlist  — get user's watchlist
 * POST   /api/watchlist  — add to watchlist
 * DELETE /api/watchlist  — remove from watchlist
 */
import { supabaseAdmin, getUserFromRequest } from '../../lib/supabase.js';

export default async function handler(req, res) {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method === 'GET') {
    const { data } = await supabaseAdmin
      .from('watchlist')
      .select('auction_id, created_at, auctions!auction_id(*)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    return res.status(200).json({ watchlist: data?.map(w => ({ ...w.auctions, watchedAt: w.created_at })) });
  }

  if (req.method === 'POST') {
    const { auctionId } = req.body;
    if (!auctionId) return res.status(400).json({ error: 'auctionId required' });
    const { data, error } = await supabaseAdmin.from('watchlist')
      .upsert({ user_id: user.id, auction_id: auctionId }, { onConflict: 'user_id,auction_id' })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ success: true, item: data });
  }

  if (req.method === 'DELETE') {
    const { auctionId } = req.body;
    await supabaseAdmin.from('watchlist').delete().eq('user_id', user.id).eq('auction_id', auctionId);
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
