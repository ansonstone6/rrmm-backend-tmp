/**
 * POST /api/auctions/[id]/bid
 * Place a bid on an auction
 */
import { getUserFromRequest } from '../../../lib/supabase.js';
import { placeBid } from '../../../lib/auction-engine.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  if (user.role !== 'buyer') return res.status(403).json({ error: 'Verified buyer account required' });
  if (!user.verified) return res.status(403).json({ error: 'Buyer account pending verification' });
  if (!user.stripe_customer_id) return res.status(400).json({ error: 'Payment method required. Please add a card to your account.' });

  const { id: auctionId } = req.query;
  const { amount, proxyMax } = req.body;

  if (!amount || isNaN(amount)) return res.status(400).json({ error: 'Valid bid amount required' });

  const result = await placeBid({
    auctionId, bidderId: user.id,
    amount: parseFloat(amount),
    proxyMax: proxyMax ? parseFloat(proxyMax) : null,
  });

  if (result.error) return res.status(400).json({ error: result.error });
  return res.status(200).json(result);
}
