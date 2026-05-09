/**
 * POST /api/users/register
 * Called after Supabase Auth signup to create the users profile row
 */
import { supabaseAdmin } from '../../lib/supabase.js';
import { getOrCreateCustomer } from '../../lib/stripe.js';
import Stripe from 'stripe';

const stripe = new (require('stripe'))(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { authId, email, displayName, handle, role, followerCount } = req.body;
  if (!authId || !email || !role) return res.status(400).json({ error: 'authId, email, role required' });
  if (!['photographer','buyer'].includes(role)) return res.status(400).json({ error: 'Role must be photographer or buyer' });

  // Buyer minimum follower check
  if (role === 'buyer' && (!followerCount || followerCount < 50000)) {
    return res.status(400).json({ error: 'Buyer accounts require a minimum 50,000 followers on at least one platform. Submit your channel for manual review.' });
  }

  // Check handle uniqueness for photographers
  if (role === 'photographer' && handle) {
    const { data: existing } = await supabaseAdmin.from('users').select('id').eq('handle', handle).single();
    if (existing) return res.status(409).json({ error: 'Handle already taken' });
  }

  let stripeCustomerId = null;
  let stripeAccountId = null;

  // Buyers get a Stripe customer ID for charging
  if (role === 'buyer') {
    const customer = await getOrCreateCustomer(email, displayName);
    stripeCustomerId = customer.id;
  }

  // Photographers get a Stripe Connect Express account
  if (role === 'photographer') {
    const account = await stripe.accounts.create({
      type: 'express', country: 'US', email,
      capabilities: { transfers: { requested: true } },
      business_profile: { name: displayName || handle },
    });
    stripeAccountId = account.id;
  }

  const { data, error } = await supabaseAdmin.from('users').insert({
    auth_id: authId, email, display_name: displayName, handle,
    role, follower_count: followerCount || 0,
    stripe_customer_id: stripeCustomerId,
    stripe_account_id: stripeAccountId,
    stripe_account_status: role === 'photographer' ? 'pending_onboarding' : 'n/a',
    verified: false, // admin verifies manually
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json({ user: data });
}
