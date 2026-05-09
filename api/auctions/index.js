/**
 * GET  /api/auctions  — list active auctions (with filters)
 * POST /api/auctions  — create a new auction (photographer only)
 *                       Requires a valid attestation payload
 */
import { supabaseAdmin, getUserFromRequest } from '../../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method === 'GET')  return getAuctions(req, res);
  if (req.method === 'POST') return createAuction(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
}

// ── GET: list auctions ───────────────────────────────────────────────────
async function getAuctions(req, res) {
  const { category, status = 'active', sort = 'ends_at', limit = 20, offset = 0 } = req.query;

  let query = supabaseAdmin
    .from('auctions')
    .select('*, users!photographer_id(handle, display_name, avatar_url, verified)')
    .eq('status', status)
    .order(sort, { ascending: sort === 'ends_at' })
    .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

  if (category) query = query.eq('category', category);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  // Never expose full_url in list responses
  const sanitized = data.map(({ full_url, ...a }) => a);
  return res.status(200).json({ auctions: sanitized });
}

// ── POST: create auction with attestation ────────────────────────────────
async function createAuction(req, res) {
  const user = await getUserFromRequest(req);
  if (!user)                   return res.status(401).json({ error: 'Unauthorized' });
  if (user.role !== 'photographer') return res.status(403).json({ error: 'Photographers only' });
  if (!user.verified)          return res.status(403).json({ error: 'Account pending verification' });

  const {
    // Content fields
    title, description, category, content_type, exclusivity,
    preview_url, watermark_url, full_url, file_size_mb,
    reserve_price, duration_hours, event_tag,
    // Attestation payload — all four must be present and true
    attestation,
  } = req.body;

  // ── Validate content fields ──────────────────────────────────────────
  if (!title || !category || !content_type || !exclusivity || !preview_url || !reserve_price) {
    return res.status(400).json({ error: 'Missing required content fields' });
  }
  if (reserve_price < 25) {
    return res.status(400).json({ error: 'Minimum reserve price is $25' });
  }
  if (![2, 4, 6].includes(parseInt(duration_hours))) {
    return res.status(400).json({ error: 'Duration must be 2, 4, or 6 hours' });
  }

  // ── Validate attestation — hard block if any box not checked ────────
  if (!attestation) {
    return res.status(400).json({
      error: 'Ownership attestation required',
      detail: 'All four attestation confirmations must be submitted with every listing.'
    });
  }

  const { confirmed_ownership, confirmed_unpublished, confirmed_no_third_party, confirmed_consequences } = attestation;

  if (!confirmed_ownership || !confirmed_unpublished || !confirmed_no_third_party || !confirmed_consequences) {
    return res.status(400).json({
      error: 'Incomplete attestation',
      detail: 'All four ownership confirmations must be true. Listing rejected.',
      missing: {
        confirmed_ownership:      !confirmed_ownership,
        confirmed_unpublished:    !confirmed_unpublished,
        confirmed_no_third_party: !confirmed_no_third_party,
        confirmed_consequences:   !confirmed_consequences,
      }
    });
  }

  // ── Create the auction record ────────────────────────────────────────
  const { data: auction, error: auctionErr } = await supabaseAdmin
    .from('auctions')
    .insert({
      photographer_id: user.id,
      title, description, category, content_type, exclusivity,
      preview_url, watermark_url, full_url, file_size_mb,
      reserve_price: parseFloat(reserve_price),
      duration_hours: parseInt(duration_hours),
      event_tag, status: 'pending',
    })
    .select()
    .single();

  if (auctionErr) return res.status(500).json({ error: auctionErr.message });

  // ── Record the attestation — immutable, timestamped ─────────────────
  const ipAddress  = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  const userAgent  = req.headers['user-agent'] || 'unknown';
  const sessionId  = req.headers['x-session-id'] || null;

  const { data: attestRecord, error: attestErr } = await supabaseAdmin
    .from('attestations')
    .insert({
      auction_id:               auction.id,
      photographer_id:          user.id,
      confirmed_ownership:      true,
      confirmed_unpublished:    true,
      confirmed_no_third_party: true,
      confirmed_consequences:   true,
      attested_at:              new Date().toISOString(),
      ip_address:               ipAddress,
      user_agent:               userAgent,
      session_id:               sessionId,
      attestation_version:      'v1.0',
    })
    .select()
    .single();

  if (attestErr) {
    // Rollback the auction if attestation failed to record
    await supabaseAdmin.from('auctions').delete().eq('id', auction.id);
    return res.status(500).json({
      error: 'Failed to record attestation. Listing not submitted.',
      detail: attestErr.message
    });
  }

  // ── Link attestation back to auction ────────────────────────────────
  await supabaseAdmin
    .from('auctions')
    .update({ attestation_id: attestRecord.id, attested_at: attestRecord.attested_at })
    .eq('id', auction.id);

  return res.status(201).json({
    auction: { ...auction, attestation_id: attestRecord.id },
    attestation: {
      id:         attestRecord.id,
      attested_at: attestRecord.attested_at,
      version:    attestRecord.attestation_version,
    },
    message: 'Listing submitted for review. Attestation recorded. Typically approved within 15 minutes.'
  });
}
