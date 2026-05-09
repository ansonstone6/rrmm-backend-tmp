# RRMM Backend — Deployment Guide
## From zero to live in ~3 hours, no coding required

---

## WHAT YOU NEED BEFORE STARTING
- A credit card (all services have free tiers to start)
- About 2-3 hours and a browser

---

## STEP 1 — SUPABASE (Database + Auth + File Storage) ~30 min

1. Go to supabase.com → Create free account → New Project
2. Name: `rrmm-production` | Region: US East | Save your DB password somewhere safe
3. SQL Editor (left sidebar) → New Query → paste entire contents of `schema.sql` → Run
4. SQL Editor → New Query → paste entire contents of `supabase/attestation_migration.sql` → Run
   - This creates the attestations table (immutable — no edits or deletes allowed), an admin audit view, and adds attestation columns to the auctions table
5. Storage → Create 4 buckets:
   - `previews` (public)
   - `watermarks` (public)
   - `fullres` (**PRIVATE**)
   - `avatars` (public)
6. Settings → API → Copy and save: Project URL, anon key, service_role key

---

## STEP 2 — TWILIO (SMS) ~10 min

1. twilio.com → Create account → Get a phone number
2. Copy Account SID, Auth Token, and phone number from your Console Dashboard

---

## STEP 3 — SENDGRID (Email) ~10 min

1. sendgrid.com → Create free account (100 emails/day free)
2. Settings → API Keys → Create Full Access key → Copy it
3. Settings → Sender Authentication → Verify your sender email address

---

## STEP 4 — VERCEL (Hosting) — First Deploy ~20 min

> **Do this before configuring Stripe webhooks** — you need your live Vercel URL first.

1. Unzip the provided `rrmm-backend.zip` file on your computer first, then: github.com → Sign in → New repository → Name it `rrmm-backend` → Upload all files from the unzipped rrmm-backend folder (maintain the folder structure as-is)
2. vercel.com → New Project → Import from GitHub → select `rrmm-backend` → Deploy
3. After deploy completes, copy your live project URL — it will look like:
   `rrmm-backend-abc123.vercel.app`
   (found under the project name on your Vercel dashboard)
4. Project Settings → Environment Variables → add every variable from the **Environment Variables** table at the bottom of this guide
5. Settings → Cron Jobs → Add:
   - Path: `/api/cron/close-auctions`
   - Schedule: `*/5 * * * *`  *(runs every 5 minutes)*
6. Redeploy after adding env vars: Deployments → ••• → Redeploy

---

## STEP 5 — STRIPE (Payments + Payouts) ~20 min

> **Do this after your first Vercel deploy** so you have the real URL ready.

1. stripe.com → Create account → Activate account (you'll need to complete Stripe's business verification / KYC before real payouts to photographers will process — allow 1-2 business days)
2. Developers → API Keys → Copy publishable key and secret key
3. Connect → Settings → Account types → Enable Express accounts
4. Developers → Webhooks → Add endpoint:
   - URL: `https://YOUR-VERCEL-URL.vercel.app/api/stripe/webhook`
     *(replace `YOUR-VERCEL-URL` with your actual Vercel project URL from Step 4, e.g. `rrmm-backend-abc123.vercel.app`)*
   - Events to listen for:
     - `payment_intent.succeeded`
     - `payment_intent.payment_failed`
     - `transfer.created`
     - `payout.paid`
     - `account.updated`
5. Copy Webhook Signing Secret → go back to Vercel → Settings → Environment Variables → add `STRIPE_WEBHOOK_SECRET` → Redeploy

---

## STEP 6 — CREATE ADMIN ACCOUNT ~5 min

1. Supabase → Authentication → Users → Invite User → enter your email
2. Check your email and confirm the invitation before continuing
3. SQL Editor → New Query → Run:

```sql
UPDATE users
SET role = 'admin', verified = true
WHERE email = 'your@email.com';
```

---

## ENVIRONMENT VARIABLES

Add all of the following in Vercel → Project Settings → Environment Variables.
These match the variables in `.env.example` in your repo.

| Variable | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API → anon / public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → service_role key (keep private) |
| `STRIPE_SECRET_KEY` | Stripe → Developers → API Keys → Secret key |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe → Developers → API Keys → Publishable key |
| `STRIPE_WEBHOOK_SECRET` | Stripe → Developers → Webhooks → your endpoint → Signing secret |
| `TWILIO_ACCOUNT_SID` | Twilio Console Dashboard |
| `TWILIO_AUTH_TOKEN` | Twilio Console Dashboard |
| `TWILIO_FROM_NUMBER` | Twilio Console Dashboard → your phone number |
| `SENDGRID_API_KEY` | SendGrid → Settings → API Keys |
| `SENDGRID_FROM_EMAIL` | The sender email you verified in SendGrid |
| `SENDGRID_FROM_NAME` | Display name for outgoing emails (e.g. Rocket Ranch Media Marketplace) |
| `DOCUSIGN_ACCOUNT_ID` | DocuSign Admin → API and Keys |
| `DOCUSIGN_INTEGRATION_KEY` | DocuSign Admin → API and Keys → Integration Key |
| `DOCUSIGN_PRIVATE_KEY` | DocuSign Admin → API and Keys → RSA Private Key |
| `DOCUSIGN_USER_ID` | DocuSign Admin → API and Keys → User ID |
| `DOCUSIGN_TEMPLATE_ID` | DocuSign → Templates → your rights transfer template |
| `DOCUSIGN_BASE_URL` | `https://na4.docusign.net/restapi` (demo: `https://demo.docusign.net/restapi`) |
| `NEXT_PUBLIC_APP_URL` | Your Vercel URL, e.g. `https://rrmm-backend-abc123.vercel.app` |
| `PLATFORM_FEE_PCT` | `0.20` (20% platform commission — adjust if needed) |
| `CRON_SECRET` | Any random string — used to secure the cron endpoint |

> **Never share `SUPABASE_SERVICE_ROLE_KEY` or `STRIPE_SECRET_KEY` publicly** — these give full access to your database and Stripe account.

---

## API ENDPOINTS

| Method | Path | Description |
|---|---|---|
| GET | `/api/auctions` | List active auctions |
| POST | `/api/auctions` | Create listing (photographer) |
| GET | `/api/auctions/[id]` | Auction detail + bid history |
| POST | `/api/auctions/bid?id=[id]` | Place a bid |
| POST | `/api/uploads/presign` | Get signed upload URL |
| POST | `/api/users/register` | Register new user |
| GET | `/api/users/earnings` | Photographer earnings + history |
| GET | `/api/watchlist` | Get watchlist |
| POST | `/api/watchlist` | Add to watchlist |
| GET | `/api/notifications` | Get notifications |
| POST | `/api/stripe/connect` | Create PaymentIntent (buyer) |
| GET | `/api/stripe/connect` | Photographer payout onboarding |
| POST | `/api/stripe/webhook` | Stripe event handler |
| GET | `/api/admin/review` | List pending content |
| POST | `/api/admin/review` | Approve or reject content |
| GET | `/api/admin/dashboard` | Platform stats |
| GET | `/api/admin/attestations` | View all attestation records |
| GET | `/api/admin/attestations?from=YYYY-MM-DD&to=YYYY-MM-DD` | Filter attestations by date |

---

## MONTHLY COST AT LAUNCH

| Service | Cost |
|---|---|
| Supabase | Free (500MB DB, 1GB storage) |
| Vercel | Free (100GB bandwidth) |
| Stripe | 2.9% + $0.30 per transaction only |
| Twilio | ~$0.008/SMS |
| SendGrid | Free (100 emails/day) |

**Total: ~$0–20/month until meaningful volume**

---

## ATTESTATION SYSTEM — HOW IT WORKS

Every listing submission fails at the API level if all four attestation boxes are not confirmed by the photographer. The confirmed record is then stored permanently and cannot be edited or deleted. Each record captures:

- Timestamp of attestation
- IP address of submitting device
- Browser/device user agent
- Supabase session ID
- Exact legal text version shown to the photographer

This audit trail is accessible from your Admin Dashboard and via the `/api/admin/attestations` endpoint.

---

*Rocket Ranch Media Marketplace | Solisterra LLC | Boca Chica, TX*
