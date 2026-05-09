/**
 * POST /api/access/apply  — public buyer application (no auth required)
 * GET  /api/access/apply  — admin: list applications by status
 */
import { supabaseAdmin, getUserFromRequest } from '../../lib/supabase.js';
import { v4 as uuidv4 } from 'uuid';

export default async function handler(req, res) {
  if (req.method === 'POST') return submitApplication(req, res);
  if (req.method === 'GET')  return listApplications(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
}

async function submitApplication(req, res) {
  const { name, email, channelName, contentFocus, note, platforms } = req.body;

  if (!name || !email || !channelName || !note || !platforms?.length) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Check total followers across platforms
  const totalFollowers = platforms.reduce((s, p) => s + (parseInt(p.followers?.replace(/,/g,'')) || 0), 0);
  if (totalFollowers < 50000) {
    return res.status(400).json({
      error: 'Minimum 50,000 combined followers required across all platforms.',
      totalFound: totalFollowers,
    });
  }

  // Check for duplicate application
  const { data: existing } = await supabaseAdmin
    .from('buyer_applications').select('id, status').eq('email', email).single();
  if (existing) {
    if (existing.status === 'approved') return res.status(409).json({ error: 'This email already has an approved buyer account. Check your inbox for your login link.' });
    if (existing.status === 'pending')  return res.status(409).json({ error: 'An application for this email is already under review. We\'ll be in touch within 24 hours.' });
    if (existing.status === 'rejected') return res.status(409).json({ error: 'A previous application from this email was not approved. Contact access@rocketranch.com to appeal.' });
  }

  const ip        = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  const userAgent = req.headers['user-agent'] || 'unknown';

  const { data, error } = await supabaseAdmin.from('buyer_applications').insert({
    name, email,
    channel_name:  channelName,
    content_focus: contentFocus,
    note, platforms,
    ip_address: ip,
    user_agent: userAgent,
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  // Notify admin via notification row (Anthony / David)
  const { data: admins } = await supabaseAdmin.from('users').select('id').eq('role', 'admin');
  for (const admin of (admins || [])) {
    await supabaseAdmin.from('notifications').insert({
      user_id: admin.id, type: 'new_listing',  // reusing type for now
      title: '📬 New Buyer Application',
      body: `${name} from ${channelName} has applied for buyer access. ${totalFollowers.toLocaleString()} total followers.`,
    });
  }

  return res.status(201).json({
    success: true,
    message: 'Application received. We\'ll review it within 24 hours and email you directly.',
    applicationId: data.id,
  });
}

async function listApplications(req, res) {
  const user = await getUserFromRequest(req);
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

  const { status = 'pending', limit = 50, offset = 0 } = req.query;

  const { data, error } = await supabaseAdmin
    .from('buyer_applications')
    .select('*')
    .eq('status', status)
    .order('created_at', { ascending: true })
    .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ applications: data, count: data?.length });
}
