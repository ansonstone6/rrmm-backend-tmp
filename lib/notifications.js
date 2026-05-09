/**
 * RRMM Notification System
 * SMS via Twilio, Email via SendGrid, in-app via Supabase
 */
import { supabaseAdmin } from './supabase.js';

// Lazy-load to avoid errors if keys not set
function getTwilio() {
  const twilio = require('twilio');
  return twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}
function getSendGrid() {
  const sgMail = require('@sendgrid/mail');
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  return sgMail;
}

// ── Core: create in-app notification + optionally send SMS/email ─────────
async function createNotification({ userId, type, title, body, auctionId, sendSMS = false, sendEmail = false }) {
  // Save to DB
  await supabaseAdmin.from('notifications').insert({
    user_id: userId, type, title, body, auction_id: auctionId,
  });

  // Get user contact info
  const { data: user } = await supabaseAdmin
    .from('users').select('email, display_name').eq('id', userId).single();
  if (!user) return;

  // SMS
  if (sendSMS && process.env.TWILIO_ACCOUNT_SID) {
    try {
      const client = getTwilio();
      // Get phone from auth metadata (stored separately in real app)
      // Simplified: use email-linked phone lookup in production
    } catch (e) { console.error('SMS error:', e.message); }
  }

  // Email
  if (sendEmail && process.env.SENDGRID_API_KEY && user.email) {
    try {
      const sg = getSendGrid();
      await sg.send({
        to: user.email,
        from: { email: process.env.SENDGRID_FROM_EMAIL, name: process.env.SENDGRID_FROM_NAME },
        subject: title,
        html: emailTemplate(title, body, auctionId),
      });
    } catch (e) { console.error('Email error:', e.message); }
  }
}

function emailTemplate(title, body, auctionId) {
  const link = auctionId ? `${process.env.NEXT_PUBLIC_APP_URL}/auction/${auctionId}` : process.env.NEXT_PUBLIC_APP_URL;
  return `
    <div style="background:#000000;padding:32px;font-family:Arial,sans-serif;color:#FFFFFF;max-width:600px;margin:0 auto;border:1px solid #222;">
      <div style="margin-bottom:20px;">
        <img src="data:image/png;base64,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" alt="Rocket Ranch Starbase" style="height:48px;width:auto;display:block;"/>
      </div>
      <div style="font-size:10px;color:#A0A0A0;letter-spacing:3px;margin-bottom:24px;text-transform:uppercase;">Media Marketplace</div>
      <div style="font-size:20px;font-weight:bold;margin-bottom:12px;">${title}</div>
      <div style="font-size:15px;color:#A0A0A0;line-height:1.6;margin-bottom:24px;">${body}</div>
      ${auctionId ? `<a href="${link}" style="background:#FFFFFF;color:#000000;padding:12px 24px;text-decoration:none;font-weight:bold;font-size:14px;display:inline-block;letter-spacing:0.5px;">View Auction →</a>` : ''}
      <div style="margin-top:32px;font-size:11px;color:#444444;border-top:1px solid #222222;padding-top:16px;">Rocket Ranch Media Marketplace · Boca Chica, TX · rocketranch.com/marketplace</div>
    </div>`;
}

// ── Specific notification types ──────────────────────────────────────────

export async function notifyOutbid({ bidderId, auctionId, newBid }) {
  const { data: auction } = await supabaseAdmin.from('auctions').select('title').eq('id', auctionId).single();
  await createNotification({
    userId: bidderId, type: 'outbid', auctionId,
    title: '⚡ You\'ve been outbid!',
    body: `Someone placed a $${newBid.toLocaleString()} bid on "${auction?.title}". Bid now to stay in the lead.`,
    sendEmail: true,
  });
}

export async function notifyAuctionWon({ bidderId, auctionId, amount }) {
  const { data: auction } = await supabaseAdmin.from('auctions').select('title').eq('id', auctionId).single();
  await createNotification({
    userId: bidderId, type: 'auction_won', auctionId,
    title: '🏆 You won the auction!',
    body: `Congratulations! You won "${auction?.title}" for $${amount.toLocaleString()}. Complete your payment to receive the full-resolution content and rights transfer.`,
    sendEmail: true,
  });
}

export async function notifyAuctionLost({ bidderId, auctionId }) {
  const { data: auction } = await supabaseAdmin.from('auctions').select('title').eq('id', auctionId).single();
  await createNotification({
    userId: bidderId, type: 'auction_lost', auctionId,
    title: 'Auction ended',
    body: `"${auction?.title}" has closed. Browse new listings to find your next exclusive.`,
    sendEmail: false,
  });
}

export async function notifyPaymentReceived({ photographerId, auctionId, amount }) {
  const { data: auction } = await supabaseAdmin.from('auctions').select('title').eq('id', auctionId).single();
  await createNotification({
    userId: photographerId, type: 'payment_received', auctionId,
    title: '💰 You\'ve been paid!',
    body: `$${amount.toLocaleString()} has been transferred to your account for "${auction?.title}". Funds typically arrive within 2 business days.`,
    sendEmail: true,
  });
}

export async function notifyWatchlistUrgent({ auctionId, minutesLeft }) {
  const { data: auction } = await supabaseAdmin.from('auctions').select('title, current_bid').eq('id', auctionId).single();
  const { data: watchers } = await supabaseAdmin.from('watchlist').select('user_id').eq('auction_id', auctionId);
  for (const w of (watchers || [])) {
    await createNotification({
      userId: w.user_id, type: 'auction_ending', auctionId,
      title: `⚡ ${minutesLeft}m left on watched auction`,
      body: `"${auction?.title}" is closing soon. Current bid: $${auction?.current_bid?.toLocaleString()}`,
      sendEmail: false,
    });
  }
}

export async function notifyContentApproved({ photographerId, auctionId }) {
  const { data: auction } = await supabaseAdmin.from('auctions').select('title').eq('id', auctionId).single();
  await createNotification({
    userId: photographerId, type: 'content_approved', auctionId,
    title: '✅ Your listing is live!',
    body: `"${auction?.title}" has been approved and is now visible to all verified buyers.`,
    sendEmail: true,
  });
}

export async function notifyContentRejected({ photographerId, auctionId, reason }) {
  const { data: auction } = await supabaseAdmin.from('auctions').select('title').eq('id', auctionId).single();
  await createNotification({
    userId: photographerId, type: 'content_rejected', auctionId,
    title: '❌ Listing not approved',
    body: `"${auction?.title}" was not approved. Reason: ${reason}. Please review our content guidelines and resubmit.`,
    sendEmail: true,
  });
}
