// api/routes.js
// All RRMM API routes — mounted on Express app in server.js

const express  = require('express');
const multer   = require('multer');
const { v4: uuidv4 } = require('uuid');
const router   = express.Router();

const { supabaseAdmin } = require('../lib/supabase');
const { placeBid, closeAuction, getActiveAuctions } = require('../lib/auction-engine');
const { notifyVerifiedBuyersNewListing } = require('../lib/notifications');
const {
  createConnectOnboardingLink, checkConnectStatus,
  getOrCreateCustomer, createSetupIntent,
  createSubscription, verifyWebhook, chargeWinningBidder
} = require('../lib/stripe');
const { requireAuth, requireRole, requireCronSecret } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

// ══════════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════════

// POST /auth/register — create profile after Supabase signup
router.post('/auth/register', requireAuth, async (req, res) => {
  const { role, display_name, phone, channel_name, platform, follower_count, handle } = req.body;

  try {
    // Create base profile
    await supabaseAdmin.from('profiles').upsert({
      id: req.user.id, role, display_name,
      email: req.user.email, phone
    });

    if (role === 'photographer') {
      await supabaseAdmin.from('photographer_profiles').insert({
        user_id: req.user.id, handle: handle || `@user_${req.user.id.slice(0,6)}`
      });
    }

    if (role === 'buyer') {
      const stripeCustomerId = await getOrCreateCustomer({
        userId: req.user.id, email: req.user.email, name: display_name
      });
      await supabaseAdmin.from('buyer_profiles').insert({
        user_id:           req.user.id,
        channel_name:      channel_name || display_name,
        platform:          platform || 'other',
        follower_count:    follower_count || 0,
        stripe_customer_id: stripeCustomerId
      });
    }

    res.json({ success: true, role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// LISTINGS
// ══════════════════════════════════════════════════════════════

// POST /listings/upload — photographer uploads content
router.post('/listings/upload', requireAuth, requireRole('photographer'), upload.single('file'), async (req, res) => {
  const { title, description, category, content_type, exclusive_tier, reserve_price, duration_hours } = req.body;

  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  if (!title || !reserve_price) return res.status(400).json({ error: 'title and reserve_price required' });

  try {
    // Get photographer profile
    const { data: photoProfile } = await supabaseAdmin
      .from('photographer_profiles')
      .select('id')
      .eq('user_id', req.user.id)
      .single();

    if (!photoProfile) return res.status(403).json({ error: 'Photographer profile not found' });

    // Upload file to Supabase Storage
    const fileExt  = req.file.originalname.split('.').pop();
    const fileName = `${photoProfile.id}/${uuidv4()}.${fileExt}`;
    const bucket   = content_type === 'video' ? 'videos' : 'photos';

    const { error: uploadError } = await supabaseAdmin.storage
      .from(bucket)
      .upload(fileName, req.file.buffer, { contentType: req.file.mimetype });

    if (uploadError) throw new Error('File upload failed: ' + uploadError.message);

    const { data: { publicUrl: fileUrl } } = supabaseAdmin.storage.from(bucket).getPublicUrl(fileName);

    // Create listing (pending review)
    const { data: listing, error: lErr } = await supabaseAdmin
      .from('listings')
      .insert({
        photographer_id: photoProfile.id,
        title, description, category,
        content_type:   content_type || 'photo',
        exclusive_tier: exclusive_tier || 'full_exclusive',
        file_url:       fileUrl,
        preview_url:    fileUrl, // In production: generate watermarked preview
        status:         'pending_review'
      })
      .select()
      .single();

    if (lErr) throw new Error(lErr.message);

    // Create associated auction (starts when listing is approved)
    await supabaseAdmin.from('auctions').insert({
      listing_id:     listing.id,
      reserve_price:  parseFloat(reserve_price),
      duration_hours: parseInt(duration_hours) || 4,
      status:         'scheduled',
      starts_at:      new Date().toISOString(),
      ends_at:        new Date(Date.now() + (parseInt(duration_hours)||4) * 3600000).toISOString()
    });

    res.json({ success: true, listing_id: listing.id, message: 'Submitted for review. Typically approved within 15 minutes.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /listings/:id/approve — admin approves a listing
router.post('/listings/:id/approve', requireAuth, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  try {
    await supabaseAdmin.from('listings').update({
      status:      'active',
      reviewed_by: req.user.id,
      reviewed_at: new Date().toISOString()
    }).eq('id', id);

    // Activate the auction
    const { data: auction } = await supabaseAdmin
      .from('auctions')
      .update({ status: 'live', starts_at: new Date().toISOString() })
      .eq('listing_id', id)
      .select('*, listings(title, category, reserve_price)')
      .single();

    // Notify verified buyers
    if (auction) {
      await notifyVerifiedBuyersNewListing({
        auctionId:    auction.id,
        listingTitle: auction.listings.title,
        category:     auction.listings.category,
        startingBid:  auction.reserve_price,
        endsAt:       auction.ends_at
      });
    }

    res.json({ success: true, auction_id: auction?.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /listings/my — photographer's own listings
router.get('/listings/my', requireAuth, requireRole('photographer'), async (req, res) => {
  const { data: profile } = await supabaseAdmin
    .from('photographer_profiles')
    .select('id')
    .eq('user_id', req.user.id)
    .single();

  const { data, error } = await supabaseAdmin
    .from('listings')
    .select('*, auctions(id, status, current_bid, bid_count, ends_at)')
    .eq('photographer_id', profile.id)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ listings: data });
});

// ══════════════════════════════════════════════════════════════
// AUCTIONS
// ══════════════════════════════════════════════════════════════

// GET /auctions — list active auctions
router.get('/auctions', async (req, res) => {
  const { category, limit, offset } = req.query;
  const token = req.headers.authorization?.replace('Bearer ', '');
  let isVerifiedBuyer = false;

  if (token) {
    try {
      const { data: profile } = await supabaseAdmin
        .from('profiles').select('role').eq('id', req.user?.id).single();
      const { data: buyer } = await supabaseAdmin
        .from('buyer_profiles').select('subscription_active').eq('user_id', req.user?.id).single();
      isVerifiedBuyer = buyer?.subscription_active && profile?.role === 'buyer';
    } catch {}
  }

  try {
    const auctions = await getActiveAuctions({
      category, limit: parseInt(limit)||20,
      offset: parseInt(offset)||0, verifiedBuyer: isVerifiedBuyer
    });
    res.json({ auctions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /auctions/:id — single auction detail
router.get('/auctions/:id', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('auctions')
    .select(`
      *, listings(*, photographer_profiles(handle, rating, location, total_sales)),
      bids(amount, created_at, buyer_profiles(channel_name))
    `)
    .eq('id', req.params.id)
    .order('created_at', { ascending: false, foreignTable: 'bids' })
    .limit(10, { foreignTable: 'bids' })
    .single();

  if (error) return res.status(404).json({ error: 'Auction not found' });
  res.json({ auction: data });
});

// POST /auctions/:id/bid — place a bid
router.post('/auctions/:id/bid', requireAuth, requireRole('buyer'), async (req, res) => {
  const { amount } = req.body;
  if (!amount || isNaN(amount)) return res.status(400).json({ error: 'Valid bid amount required' });

  try {
    const { data: buyer } = await supabaseAdmin
      .from('buyer_profiles')
      .select('id, verified, subscription_active, stripe_customer_id')
      .eq('user_id', req.user.id)
      .single();

    if (!buyer) return res.status(403).json({ error: 'Buyer profile not found' });
    if (!buyer.verified) return res.status(403).json({ error: 'Account pending verification. Contact support.' });
    if (!buyer.stripe_customer_id) return res.status(400).json({ error: 'Payment method required before bidding' });

    const result = await placeBid({
      auctionId: req.params.id,
      bidderId:  buyer.id,
      amount:    parseFloat(amount),
      buyerUserId: req.user.id
    });

    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// WATCHLIST
// ══════════════════════════════════════════════════════════════

// GET /watchlist
router.get('/watchlist', requireAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('watchlist')
    .select('auction_id, created_at, auctions(*, listings(title, category, preview_url, photographer_profiles(handle)))')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ watchlist: data });
});

// POST /watchlist/toggle
router.post('/watchlist/toggle', requireAuth, async (req, res) => {
  const { auction_id } = req.body;
  if (!auction_id) return res.status(400).json({ error: 'auction_id required' });

  const { data: existing } = await supabaseAdmin
    .from('watchlist')
    .select('id')
    .eq('user_id', req.user.id)
    .eq('auction_id', auction_id)
    .single();

  if (existing) {
    await supabaseAdmin.from('watchlist').delete().eq('id', existing.id);
    return res.json({ watching: false });
  }

  await supabaseAdmin.from('watchlist').insert({ user_id: req.user.id, auction_id });
  res.json({ watching: true });
});

// ══════════════════════════════════════════════════════════════
// EARNINGS (photographer)
// ══════════════════════════════════════════════════════════════

// GET /earnings/summary
router.get('/earnings/summary', requireAuth, requireRole('photographer'), async (req, res) => {
  const { data: profile } = await supabaseAdmin
    .from('photographer_profiles')
    .select('id, total_earned, total_sales, avg_sale_price, stripe_account_id, stripe_onboarded')
    .eq('user_id', req.user.id)
    .single();

  if (!profile) return res.status(404).json({ error: 'Profile not found' });

  // Pending payouts
  const { data: pending } = await supabaseAdmin
    .from('transactions')
    .select('photographer_payout')
    .eq('photographer_id', profile.id)
    .eq('payout_status', 'pending');

  const pendingTotal = (pending || []).reduce((s, t) => s + t.photographer_payout, 0);

  // Monthly breakdown (last 6 months)
  const { data: monthly } = await supabaseAdmin.rpc('photographer_monthly_earnings', {
    p_photographer_id: profile.id, p_months: 6
  });

  res.json({
    total_earned:   profile.total_earned,
    total_sales:    profile.total_sales,
    avg_sale_price: profile.avg_sale_price,
    pending_payout: pendingTotal,
    stripe_onboarded: profile.stripe_onboarded,
    monthly_breakdown: monthly || []
  });
});

// GET /earnings/transactions
router.get('/earnings/transactions', requireAuth, requireRole('photographer'), async (req, res) => {
  const { data: profile } = await supabaseAdmin
    .from('photographer_profiles').select('id').eq('user_id', req.user.id).single();

  const { data, error } = await supabaseAdmin
    .from('transactions')
    .select('*, listings(title, category), buyer_profiles(channel_name)')
    .eq('photographer_id', profile.id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ transactions: data });
});

// ══════════════════════════════════════════════════════════════
// STRIPE
// ══════════════════════════════════════════════════════════════

// POST /stripe/connect/start — photographer begins Stripe onboarding
router.post('/stripe/connect/start', requireAuth, requireRole('photographer'), async (req, res) => {
  try {
    const result = await createConnectOnboardingLink({
      photographerId: req.user.id,
      email:          req.user.email,
      returnUrl:  `${process.env.NEXT_PUBLIC_APP_URL}/connect/success`,
      refreshUrl: `${process.env.NEXT_PUBLIC_APP_URL}/connect/refresh`
    });

    // Save accountId to photographer profile
    await supabaseAdmin.from('photographer_profiles')
      .update({ stripe_account_id: result.accountId })
      .eq('user_id', req.user.id);

    res.json({ onboarding_url: result.onboardingUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /stripe/connect/verify — check onboarding complete
router.post('/stripe/connect/verify', requireAuth, requireRole('photographer'), async (req, res) => {
  const { data: profile } = await supabaseAdmin
    .from('photographer_profiles')
    .select('stripe_account_id')
    .eq('user_id', req.user.id)
    .single();

  if (!profile?.stripe_account_id) return res.status(400).json({ error: 'No Connect account found' });

  const status = await checkConnectStatus(profile.stripe_account_id);

  if (status.onboarded) {
    await supabaseAdmin.from('photographer_profiles')
      .update({ stripe_onboarded: true })
      .eq('user_id', req.user.id);
  }

  res.json(status);
});

// POST /stripe/buyer/setup — buyer adds payment method
router.post('/stripe/buyer/setup', requireAuth, requireRole('buyer'), async (req, res) => {
  const { data: buyer } = await supabaseAdmin
    .from('buyer_profiles')
    .select('stripe_customer_id')
    .eq('user_id', req.user.id)
    .single();

  if (!buyer?.stripe_customer_id) return res.status(400).json({ error: 'Buyer profile not found' });

  const { clientSecret, setupIntentId } = await createSetupIntent(buyer.stripe_customer_id);
  res.json({ client_secret: clientSecret, setup_intent_id: setupIntentId });
});

// POST /stripe/subscribe — buyer subscribes to $99/mo Verified plan
router.post('/stripe/subscribe', requireAuth, requireRole('buyer'), async (req, res) => {
  const { payment_method_id } = req.body;
  if (!payment_method_id) return res.status(400).json({ error: 'payment_method_id required' });

  const { data: buyer } = await supabaseAdmin
    .from('buyer_profiles').select('stripe_customer_id').eq('user_id', req.user.id).single();

  try {
    const result = await createSubscription(buyer.stripe_customer_id, payment_method_id);

    await supabaseAdmin.from('buyer_profiles').update({
      subscription_active: true,
      subscription_end:    result.currentPeriodEnd
    }).eq('user_id', req.user.id);

    res.json({ success: true, subscription_id: result.subscriptionId });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /stripe/webhook — handle Stripe events
router.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    event = verifyWebhook(req.body, req.headers['stripe-signature']);
  } catch (err) {
    return res.status(400).json({ error: 'Webhook signature invalid' });
  }

  switch (event.type) {
    case 'payment_intent.succeeded':
      // Payment confirmed — mark transaction as paid
      const pi = event.data.object;
      await supabaseAdmin.from('transactions')
        .update({ payout_status: 'processing' })
        .eq('stripe_payment_id', pi.id);
      break;

    case 'customer.subscription.deleted':
      // Subscription cancelled
      const sub = event.data.object;
      await supabaseAdmin.from('buyer_profiles')
        .update({ subscription_active: false })
        .eq('stripe_customer_id', sub.customer);
      break;

    case 'transfer.paid':
      // Photographer received their payout
      const transfer = event.data.object;
      const auctionId = transfer.metadata?.auction_id;
      if (auctionId) {
        await supabaseAdmin.from('transactions')
          .update({ payout_status: 'paid', payout_date: new Date().toISOString() })
          .eq('auction_id', auctionId);
      }
      break;
  }

  res.json({ received: true });
});

// ══════════════════════════════════════════════════════════════
// NOTIFICATIONS
// ══════════════════════════════════════════════════════════════

// GET /notifications
router.get('/notifications', requireAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('notifications')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ notifications: data });
});

// POST /notifications/read-all
router.post('/notifications/read-all', requireAuth, async (req, res) => {
  await supabaseAdmin.from('notifications').update({ read: true }).eq('user_id', req.user.id);
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════
// ADMIN
// ══════════════════════════════════════════════════════════════

// GET /admin/pending-listings — review queue
router.get('/admin/pending-listings', requireAuth, requireRole('admin'), async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('listings')
    .select('*, photographer_profiles(handle, rating), auctions(reserve_price, duration_hours)')
    .eq('status', 'pending_review')
    .order('created_at', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ listings: data });
});

// GET /admin/dashboard — platform stats
router.get('/admin/dashboard', requireAuth, requireRole('admin'), async (req, res) => {
  const [auctions, transactions, photographers, buyers] = await Promise.all([
    supabaseAdmin.from('auctions').select('id, status, current_bid', { count: 'exact' }).eq('status', 'live'),
    supabaseAdmin.from('transactions').select('sale_price, platform_commission', { count: 'exact' }),
    supabaseAdmin.from('photographer_profiles').select('id', { count: 'exact' }),
    supabaseAdmin.from('buyer_profiles').select('id, subscription_active', { count: 'exact' })
  ]);

  const totalGMV = (transactions.data || []).reduce((s, t) => s + t.sale_price, 0);
  const totalRevenue = (transactions.data || []).reduce((s, t) => s + t.platform_commission, 0);
  const subscribers = (buyers.data || []).filter(b => b.subscription_active).length;

  res.json({
    live_auctions:   auctions.count,
    total_gmv:       totalGMV,
    platform_revenue: totalRevenue,
    total_photographers: photographers.count,
    total_buyers:    buyers.count,
    subscribers
  });
});

// ══════════════════════════════════════════════════════════════
// CRON (internal — protected by ADMIN_SECRET)
// ══════════════════════════════════════════════════════════════

// POST /cron/close-auctions — called every minute by cron job
router.post('/cron/close-auctions', requireCronSecret, async (req, res) => {
  const now = new Date().toISOString();

  // Find all live auctions past their end time
  const { data: expiredAuctions } = await supabaseAdmin
    .from('auctions')
    .select('id')
    .in('status', ['live', 'closing'])
    .lt('ends_at', now);

  const results = [];
  for (const a of (expiredAuctions || [])) {
    try {
      const result = await closeAuction(a.id);
      results.push({ id: a.id, ...result });
    } catch (err) {
      results.push({ id: a.id, error: err.message });
    }
  }

  res.json({ processed: results.length, results });
});

// POST /cron/closing-alerts — 15-min warning (called every minute)
router.post('/cron/closing-alerts', requireCronSecret, async (req, res) => {
  const { sendClosingAlerts } = require('../lib/notifications');
  const in15 = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const now  = new Date(Date.now() + 14 * 60 * 1000).toISOString();

  const { data: closing } = await supabaseAdmin
    .from('auctions')
    .select('id, listings(title)')
    .eq('status', 'live')
    .gte('ends_at', now)
    .lte('ends_at', in15);

  for (const a of (closing || [])) {
    await sendClosingAlerts(a.id, a.listings?.title);
  }

  res.json({ alerted: (closing || []).length });
});

module.exports = router;
