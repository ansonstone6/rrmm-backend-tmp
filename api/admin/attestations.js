/**
 * GET /api/admin/attestations
 * Admin-only audit log of all photographer attestations
 * Useful for legal disputes, IP claims, or platform audits
 */
import { supabaseAdmin, getUserFromRequest } from '../../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const user = await getUserFromRequest(req);
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

  const { auctionId, photographerId, from, to, limit = 50, offset = 0 } = req.query;

  // Query the audit view for a clean joined result
  let query = supabaseAdmin
    .from('attestation_audit_log')
    .select('*')
    .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

  if (auctionId)      query = query.eq('auction_id', auctionId);     // not in view but added for reference
  if (photographerId) query = query.eq('photographer_email', photographerId);
  if (from)           query = query.gte('attested_at', from);
  if (to)             query = query.lte('attested_at', to);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ attestations: data, count: data?.length });
}
