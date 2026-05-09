/**
 * GET /api/stripe/connect  — get photographer's Stripe Connect onboarding link
 * POST /api/stripe/payment-intent  — create PaymentIntent for auction winner
 */
import { getUserFromRequest } from '../../lib/supabase.js';
import { createConnectOnboardingLink, createPaymentIntent } from '../../lib/stripe.js';
import { supabaseAdmin } from '../../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method === 'GET') return getOnboardingLink(req, res);
  if (req.method === 'POST') return createIntent(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
}

async function getOnboardingLink(req, res) {
  const user = await getUserFromRequest(req);
  if (!user || user.role !== 'photographer') return res.status(403).json({ error: 'Photographers only' });
  if (!user.stripe_account_id) return res.status(400).json({ error: 'No Stripe account found' });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const link = await createConnectOnboardingLink(
    user.stripe_account_id,
    `${appUrl}/account?stripe=success`,
    `${appUrl}/account?stripe=refresh`
  );
  return res.status(200).json({ url: link.url });
}

async function createIntent(req, res) {
  const user = await getUserFromRequest(req);
  if (!user || user.role !== 'buyer') return res.status(403).json({ error: 'Buyers only' });
  if (!user.stripe_customer_id) return res.status(400).json({ error: 'No payment method on file' });

  const { auctionId } = req.body;
  const { data: auction } = await supabaseAdmin
    .from('auctions')
    .select('*, users!photographer_id(stripe_account_id)')
    .eq('id', auctionId).single();

  if (!auction) return res.status(404).json({ error: 'Auction not found' });
  if (auction.buyer_id !== user.id) return res.status(403).json({ error: 'You did not win this auction' });
  if (auction.status !== 'sold') return res.status(400).json({ error: 'Auction not yet closed' });

  const intent = await createPaymentIntent({
    amount: auction.sale_price,
    buyerStripeId: user.stripe_customer_id,
    auctionId,
    photographerAccountId: auction.users.stripe_account_id,
  });

  // Store payment intent ID
  await supabaseAdmin.from('transactions')
    .update({ payment_intent_id: intent.id, payment_status: 'processing' })
    .eq('auction_id', auctionId);

  return res.status(200).json({ clientSecret: intent.client_secret });
}
