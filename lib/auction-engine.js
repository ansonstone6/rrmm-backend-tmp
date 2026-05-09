/**
 * RRMM Auction Engine
 * Core logic: bid placement, proxy bidding, auto-extend, auction close
 */
import { supabaseAdmin } from './supabase.js';
import { notifyOutbid, notifyAuctionWon, notifyAuctionLost, notifyWatchlistUrgent } from './notifications.js';
import { createPaymentIntent } from './stripe.js';

const PLATFORM_FEE = parseFloat(process.env.PLATFORM_FEE_PCT || '0.20');
const AUTO_EXTEND_MINUTES = 5;
const AUTO_EXTEND_TRIGGER_MINUTES = 5; // bid within last N minutes triggers extension
const MAX_EXTENSIONS = 6; // max 30 min total extension

// ── Place a bid ──────────────────────────────────────────────────────────
export async function placeBid({ auctionId, bidderId, amount, proxyMax = null }) {
  // 1. Load auction with lock
  const { data: auction, error: aErr } = await supabaseAdmin
    .from('auctions').select('*').eq('id', auctionId).single();
  if (aErr || !auction) return { error: 'Auction not found' };
  if (auction.status !== 'active') return { error: `Auction is ${auction.status}` };
  if (new Date() > new Date(auction.ends_at)) return { error: 'Auction has ended' };

  // 2. Validate bid amount
  const minBid = auction.current_bid > 0
    ? Math.ceil(auction.current_bid * 1.05)  // must beat by 5%
    : auction.reserve_price;
  if (amount < minBid) return { error: `Bid must be at least $${minBid}` };
  if (bidderId === auction.photographer_id) return { error: 'Photographers cannot bid on own listings' };

  // 3. Get current winning bid
  const { data: currentWinner } = await supabaseAdmin
    .from('bids').select('*').eq('auction_id', auctionId).eq('is_winning', true).single();

  // 4. Handle proxy bidding — if current winner has a proxy that covers the new bid
  if (currentWinner?.is_proxy && currentWinner.proxy_max > amount && currentWinner.bidder_id !== bidderId) {
    const counterBid = Math.min(amount + 50, currentWinner.proxy_max);
    await _recordBid({ auctionId, bidderId: currentWinner.bidder_id, amount: counterBid, isProxy: true, proxyMax: currentWinner.proxy_max, isWinning: true });
    await _recordBid({ auctionId, bidderId, amount, isProxy: false, isWinning: false });
    await supabaseAdmin.from('auctions').update({ current_bid: counterBid, bid_count: auction.bid_count + 2 }).eq('id', auctionId);
    await notifyOutbid({ bidderId, auctionId, newBid: counterBid });
    return { success: true, winning: false, currentBid: counterBid, message: 'Outbid by proxy' };
  }

  // 5. Mark previous winner as outbid
  if (currentWinner) {
    await supabaseAdmin.from('bids').update({ is_winning: false, outbid_at: new Date().toISOString() }).eq('id', currentWinner.id);
    await notifyOutbid({ bidderId: currentWinner.bidder_id, auctionId, newBid: amount });
  }

  // 6. Record the new winning bid
  await _recordBid({ auctionId, bidderId, amount, isProxy: !!proxyMax, proxyMax, isWinning: true });

  // 7. Auto-extend if bid is within closing window
  const endsAt = new Date(auction.ends_at);
  const now = new Date();
  const minutesLeft = (endsAt - now) / 60000;
  let newEndsAt = auction.ends_at;

  if (minutesLeft <= AUTO_EXTEND_TRIGGER_MINUTES && auction.extension_count < MAX_EXTENSIONS) {
    newEndsAt = new Date(endsAt.getTime() + AUTO_EXTEND_MINUTES * 60 * 1000).toISOString();
    await supabaseAdmin.from('auctions').update({
      current_bid: amount,
      bid_count: auction.bid_count + 1,
      ends_at: newEndsAt,
      auto_extended: true,
      extension_count: auction.extension_count + 1,
    }).eq('id', auctionId);
  } else {
    await supabaseAdmin.from('auctions').update({
      current_bid: amount,
      bid_count: auction.bid_count + 1,
    }).eq('id', auctionId);
  }

  // 8. Notify watchlist users of urgency if < 30 min left
  if (minutesLeft <= 30) {
    await notifyWatchlistUrgent({ auctionId, minutesLeft: Math.round(minutesLeft) });
  }

  return { success: true, winning: true, currentBid: amount, endsAt: newEndsAt };
}

async function _recordBid({ auctionId, bidderId, amount, isProxy, proxyMax, isWinning }) {
  await supabaseAdmin.from('bids').insert({
    auction_id: auctionId, bidder_id: bidderId,
    amount, is_proxy: isProxy, proxy_max: proxyMax, is_winning: isWinning,
  });
}

// ── Close an auction ─────────────────────────────────────────────────────
export async function closeAuction(auctionId) {
  const { data: auction } = await supabaseAdmin
    .from('auctions').select('*, users!photographer_id(stripe_account_id, email)')
    .eq('id', auctionId).single();

  if (!auction || auction.status !== 'active') return { error: 'Cannot close auction' };

  // Find winning bid
  const { data: winningBid } = await supabaseAdmin
    .from('bids').select('*, users!bidder_id(*)').eq('auction_id', auctionId)
    .eq('is_winning', true).single();

  // No bids or below reserve
  if (!winningBid || winningBid.amount < auction.reserve_price) {
    await supabaseAdmin.from('auctions').update({ status: 'unsold' }).eq('id', auctionId);
    await _notifyAllBidders(auctionId, 'unsold');
    return { success: true, sold: false };
  }

  const salePrice = winningBid.amount;
  const platformFee = parseFloat((salePrice * PLATFORM_FEE).toFixed(2));
  const photographerPayout = parseFloat((salePrice - platformFee).toFixed(2));

  // Update auction to sold
  await supabaseAdmin.from('auctions').update({
    status: 'sold',
    sale_price: salePrice,
    platform_fee: platformFee,
    photographer_payout: photographerPayout,
    buyer_id: winningBid.bidder_id,
    winning_bid_id: winningBid.id,
  }).eq('id', auctionId);

  // Create transaction record
  const { data: tx } = await supabaseAdmin.from('transactions').insert({
    auction_id: auctionId,
    buyer_id: winningBid.bidder_id,
    photographer_id: auction.photographer_id,
    gross_amount: salePrice,
    platform_fee: platformFee,
    photographer_payout: photographerPayout,
  }).select().single();

  // Notify winner and photographer
  await notifyAuctionWon({ bidderId: winningBid.bidder_id, auctionId, amount: salePrice });
  await _notifyAllBidders(auctionId, 'lost', winningBid.bidder_id);

  // Trigger payment (handled async by Stripe webhook flow)
  // The buyer's payment UI will prompt checkout on win notification

  return { success: true, sold: true, transactionId: tx.id, salePrice, photographerPayout };
}

// Notify all non-winning bidders
async function _notifyAllBidders(auctionId, outcome, excludeBidderId = null) {
  const { data: bids } = await supabaseAdmin
    .from('bids').select('bidder_id').eq('auction_id', auctionId)
    .neq('bidder_id', excludeBidderId);
  const uniqueBidders = [...new Set(bids?.map(b => b.bidder_id) || [])];
  for (const bidderId of uniqueBidders) {
    if (outcome === 'lost') await notifyAuctionLost({ bidderId, auctionId });
  }
}

// ── Activate a pending auction (called after admin approval) ─────────────
export async function activateAuction(auctionId) {
  const { data: auction } = await supabaseAdmin
    .from('auctions').select('*').eq('id', auctionId).single();
  if (!auction || auction.status !== 'pending') return { error: 'Not a pending auction' };

  const startsAt = new Date();
  const endsAt = new Date(startsAt.getTime() + auction.duration_hours * 60 * 60 * 1000);

  await supabaseAdmin.from('auctions').update({
    status: 'active',
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
  }).eq('id', auctionId);

  // Notify all verified buyers
  const { data: buyers } = await supabaseAdmin
    .from('users').select('id').eq('role', 'buyer').eq('verified', true);
  for (const buyer of (buyers || [])) {
    await supabaseAdmin.from('notifications').insert({
      user_id: buyer.id, type: 'new_listing', auction_id: auctionId,
      title: '📷 New Content Listed', body: `"${auction.title}" is now live for bidding.`,
    });
  }

  return { success: true, startsAt, endsAt };
}

// ── Called by cron job every minute to close expired auctions ────────────
export async function processExpiredAuctions() {
  const { data: expired } = await supabaseAdmin
    .from('auctions').select('id')
    .eq('status', 'active')
    .lt('ends_at', new Date().toISOString());

  const results = [];
  for (const auction of (expired || [])) {
    const result = await closeAuction(auction.id);
    results.push({ id: auction.id, ...result });
  }
  return results;
}
