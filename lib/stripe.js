import Stripe from 'stripe';

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
});

const PLATFORM_FEE = parseFloat(process.env.PLATFORM_FEE_PCT || '0.20');

// Create a PaymentIntent to charge the buyer
export async function createPaymentIntent({ amount, buyerStripeId, auctionId, photographerAccountId }) {
  const amountCents = Math.round(amount * 100);
  const platformFeeCents = Math.round(amountCents * PLATFORM_FEE);

  return stripe.paymentIntents.create({
    amount: amountCents,
    currency: 'usd',
    customer: buyerStripeId,
    payment_method_types: ['card'],
    application_fee_amount: platformFeeCents,
    transfer_data: { destination: photographerAccountId },
    metadata: { auction_id: auctionId },
  });
}

// Initiate payout to photographer via Stripe Connect
export async function initiatePhotographerPayout({ photographerAccountId, amount, auctionId }) {
  const amountCents = Math.round(amount * 100);
  return stripe.transfers.create({
    amount: amountCents,
    currency: 'usd',
    destination: photographerAccountId,
    metadata: { auction_id: auctionId },
  });
}

// Create onboarding link for photographer Stripe Connect setup
export async function createConnectOnboardingLink(accountId, returnUrl, refreshUrl) {
  return stripe.accountLinks.create({
    account: accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: 'account_onboarding',
  });
}

// Create or retrieve Stripe customer for buyer
export async function getOrCreateCustomer(email, name) {
  const existing = await stripe.customers.list({ email, limit: 1 });
  if (existing.data.length > 0) return existing.data[0];
  return stripe.customers.create({ email, name });
}
