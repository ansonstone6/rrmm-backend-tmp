/**
 * GET    /api/auctions/[id]  — get single auction detail
 * PATCH  /api/auctions/[id]  — update auction (photographer or admin)
 * DELETE /api/auctions/[id]  — cancel auction (admin only)
 */
import { supabaseAdmin, getUserFromRequest } from '../../lib/supabase.js';

export default async function handler(req, res) {
  const { id } = req.query;
  if (req.method === 'GET') return getAuction(req, res, id);
  if (req.method === 'PATCH') return updateAuction(req, res, id);
  if (req.method === 'DELETE') return cancelAuction(req, res, id);
  return res.status(405).json({ error: 'Method not allowed' });
}

async function getAuction(req, res, id) {
  const user = await getUserFromRequest(req);

  const { data: auction, error } = await supabaseAdmin
    .from('auctions')
    .select(`*, 
      users!photographer_id(id, handle, display_name, avatar_url, total_sales),
      bids(id, amount, bidder_id, is_winning, created_at, users!bidder_id(handle, display_name))`)
    .eq('id', id).single();

  if (error || !auction) return res.status(404).json({ error: 'Auction not found' });

  // Increment view count
  await supabaseAdmin.from('auctions').update({ view_count: auction.view_count + 1 }).eq('id', id);

  // Only reveal full_url if user is the buyer who won and paid
  const isBuyer = user?.id === auction.buyer_id;
  const hasPaid = auction.status === 'sold'; // simplified; check transaction in production
  const response = { ...auction };
  if (!isBuyer || !hasPaid) delete response.full_url;

  return res.status(200).json({ auction: response });
}

async function updateAuction(req, res, id) {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { data: auction } = await supabaseAdmin.from('auctions').select('*').eq('id', id).single();
  if (!auction) return res.status(404).json({ error: 'Not found' });

  const isOwner = auction.photographer_id === user.id;
  const isAdmin = user.role === 'admin';
  if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Forbidden' });
  if (auction.status === 'active' && !isAdmin) return res.status(400).json({ error: 'Cannot edit active auction' });

  const allowedFields = ['title', 'description', 'event_tag', 'is_featured'];
  const updates = {};
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  }

  const { data, error } = await supabaseAdmin.from('auctions').update(updates).eq('id', id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ auction: data });
}

async function cancelAuction(req, res, id) {
  const user = await getUserFromRequest(req);
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

  const { data: auction } = await supabaseAdmin.from('auctions').select('status').eq('id', id).single();
  if (auction?.status === 'sold') return res.status(400).json({ error: 'Cannot cancel a sold auction' });

  await supabaseAdmin.from('auctions').update({ status: 'cancelled' }).eq('id', id);
  return res.status(200).json({ success: true });
}
