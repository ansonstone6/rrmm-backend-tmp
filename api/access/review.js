/**
 * POST /api/access/review  — admin: approve or reject a buyer application
 * POST /api/access/invite  — admin: send a direct invite bypassing the queue
 */
import { supabaseAdmin, getUserFromRequest } from '../../lib/supabase.js';
import { v4 as uuidv4 } from 'uuid';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const user = await getUserFromRequest(req);
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

  const { applicationId, decision, note, directInviteEmail } = req.body;

  // ── Direct invite (no application required) ──────────────────────────
  if (directInviteEmail) {
    const inviteToken = uuidv4();
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;

    // Upsert a pre-approved application record for tracking
    await supabaseAdmin.from('buyer_applications').upsert({
      email: directInviteEmail,
      name: directInviteEmail,
      channel_name: 'Direct Invite',
      note: `Direct invite sent by admin ${user.display_name || user.email}`,
      platforms: [],
      status: 'approved',
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
      invite_token: inviteToken,
      invite_sent_at: new Date().toISOString(),
    }, { onConflict: 'email' });

    // Send invite email via SendGrid
    await _sendInviteEmail(directInviteEmail, inviteToken, appUrl);

    return res.status(200).json({
      success: true,
      message: `Direct invite sent to ${directInviteEmail}`,
      inviteLink: `${appUrl}/join?token=${inviteToken}`,
    });
  }

  // ── Review an existing application ───────────────────────────────────
  if (!applicationId || !decision) return res.status(400).json({ error: 'applicationId and decision required' });
  if (!['approved','rejected'].includes(decision)) return res.status(400).json({ error: 'Decision must be approved or rejected' });

  const { data: app } = await supabaseAdmin
    .from('buyer_applications').select('*').eq('id', applicationId).single();
  if (!app) return res.status(404).json({ error: 'Application not found' });
  if (app.status !== 'pending') return res.status(400).json({ error: `Application already ${app.status}` });

  const appUrl   = process.env.NEXT_PUBLIC_APP_URL;
  const inviteToken = decision === 'approved' ? uuidv4() : null;

  await supabaseAdmin.from('buyer_applications').update({
    status: decision,
    reviewed_by: user.id,
    reviewed_at: new Date().toISOString(),
    review_note: note || null,
    invite_token: inviteToken,
    invite_sent_at: decision === 'approved' ? new Date().toISOString() : null,
  }).eq('id', applicationId);

  if (decision === 'approved') {
    await _sendApprovalEmail(app.email, app.name, app.channel_name, inviteToken, appUrl);
    return res.status(200).json({
      success: true, decision,
      message: `${app.name} approved. Login invite sent to ${app.email}.`,
      inviteLink: `${appUrl}/join?token=${inviteToken}`,
    });
  } else {
    await _sendRejectionEmail(app.email, app.name, note);
    return res.status(200).json({ success: true, decision, message: `${app.name}'s application rejected.` });
  }
}

async function _sendApprovalEmail(email, name, channel, token, appUrl) {
  if (!process.env.SENDGRID_API_KEY) return;
  try {
    const sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    await sgMail.send({
      to: email,
      from: { email: process.env.SENDGRID_FROM_EMAIL, name: process.env.SENDGRID_FROM_NAME },
      subject: '✅ You\'re approved — Rocket Ranch Media Marketplace',
      html: `
        <div style="background:#000000;padding:32px;font-family:Arial,sans-serif;color:#FFFFFF;max-width:600px;margin:0 auto;border:1px solid #222;">
          <div style="margin-bottom:20px;"><img src="data:image/png;base64,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" alt="Rocket Ranch Starbase" style="height:48px;width:auto;display:block;"/></div>
          <div style="font-size:10px;color:#A0A0A0;letter-spacing:3px;margin-bottom:24px;text-transform:uppercase;">Media Marketplace</div>
          <div style="font-size:20px;font-weight:bold;margin-bottom:12px;">Welcome, ${name} 🎉</div>
          <p style="color:#A0A0A0;line-height:1.6;margin-bottom:20px;">Your application for <strong style="color:#FFFFFF">${channel}</strong> has been approved. You now have verified buyer access to Rocket Ranch Media Marketplace.</p>
          <p style="color:#A0A0A0;line-height:1.6;margin-bottom:24px;">Click the button below to set up your account and add a payment method. Your access link expires in 72 hours.</p>
          <a href="${appUrl}/join?token=${token}" style="background:#FFFFFF;color:#000000;padding:14px 28px;text-decoration:none;font-weight:bold;font-size:15px;display:inline-block;">Set Up My Account →</a>
          <p style="color:#444444;font-size:12px;margin-top:32px;border-top:1px solid #222222;padding-top:16px;">Rocket Ranch Media Marketplace · Boca Chica, TX · rocketranch.com/marketplace</p>
        </div>`,
    });
  } catch(e) { console.error('Approval email error:', e.message); }
}

async function _sendRejectionEmail(email, name, reason) {
  if (!process.env.SENDGRID_API_KEY) return;
  try {
    const sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    await sgMail.send({
      to: email,
      from: { email: process.env.SENDGRID_FROM_EMAIL, name: process.env.SENDGRID_FROM_NAME },
      subject: 'Your RRMM application — update',
      html: `
        <div style="background:#000000;padding:32px;font-family:Arial,sans-serif;color:#FFFFFF;max-width:600px;margin:0 auto;border:1px solid #222;">
          <div style="margin-bottom:20px;"><img src="data:image/png;base64,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" alt="Rocket Ranch Starbase" style="height:48px;width:auto;display:block;"/></div>
          <div style="font-size:10px;color:#A0A0A0;letter-spacing:3px;margin-bottom:24px;text-transform:uppercase;">Media Marketplace</div>
          <div style="font-size:18px;font-weight:bold;margin-bottom:12px;">Hi ${name},</div>
          <p style="color:#A0A0A0;line-height:1.6;margin-bottom:16px;">Thank you for applying for buyer access. After reviewing your application, we're unable to approve it at this time.</p>
          ${reason ? `<p style="color:#A0A0A0;line-height:1.6;margin-bottom:16px;"><strong style="color:#FFFFFF">Reason:</strong> ${reason}</p>` : ''}
          <p style="color:#A0A0A0;line-height:1.6;">If you believe this decision was made in error, please email us at <a href="mailto:access@rocketranch.com" style="color:#FFFFFF;">access@rocketranch.com</a>.</p>
        </div>`,
    });
  } catch(e) { console.error('Rejection email error:', e.message); }
}

async function _sendInviteEmail(email, token, appUrl) {
  if (!process.env.SENDGRID_API_KEY) return;
  try {
    const sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    await sgMail.send({
      to: email,
      from: { email: process.env.SENDGRID_FROM_EMAIL, name: process.env.SENDGRID_FROM_NAME },
      subject: 'You\'ve been invited — Rocket Ranch Media Marketplace',
      html: `
        <div style="background:#000000;padding:32px;font-family:Arial,sans-serif;color:#FFFFFF;max-width:600px;margin:0 auto;border:1px solid #222;">
          <div style="margin-bottom:20px;"><img src="data:image/png;base64,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" alt="Rocket Ranch Starbase" style="height:48px;width:auto;display:block;"/></div>
          <div style="font-size:10px;color:#A0A0A0;letter-spacing:3px;margin-bottom:24px;text-transform:uppercase;">Media Marketplace</div>
          <div style="font-size:20px;font-weight:bold;margin-bottom:12px;">You're invited 🚀</div>
          <p style="color:#A0A0A0;line-height:1.6;margin-bottom:24px;">You've been personally invited to access Rocket Ranch Media Marketplace — exclusive Starbase content, auctioned in real time. Click below to set up your account.</p>
          <a href="${appUrl}/join?token=${token}" style="background:#FFFFFF;color:#000000;padding:14px 28px;text-decoration:none;font-weight:bold;font-size:15px;display:inline-block;">Accept Invitation →</a>
          <p style="color:#444444;font-size:12px;margin-top:32px;border-top:1px solid #222222;padding-top:16px;">This link expires in 72 hours · Rocket Ranch Media Marketplace · Boca Chica, TX</p>
        </div>`,
    });
  } catch(e) { console.error('Invite email error:', e.message); }
}
