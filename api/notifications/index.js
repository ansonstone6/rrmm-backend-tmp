/**
 * GET   /api/notifications        — get user's notifications
 * PATCH /api/notifications/[id]   — mark as read
 * PATCH /api/notifications/read-all — mark all as read
 */
import { supabaseAdmin, getUserFromRequest } from '../../lib/supabase.js';

export default async function handler(req, res) {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method === 'GET') {
    const { data } = await supabaseAdmin
      .from('notifications').select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    const unread = data?.filter(n => !n.read).length || 0;
    return res.status(200).json({ notifications: data, unread });
  }

  if (req.method === 'PATCH') {
    const { id, readAll } = req.body;
    if (readAll) {
      await supabaseAdmin.from('notifications').update({ read: true }).eq('user_id', user.id);
    } else if (id) {
      await supabaseAdmin.from('notifications').update({ read: true }).eq('id', id).eq('user_id', user.id);
    }
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
