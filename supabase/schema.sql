-- ============================================================
-- ROCKET RANCH MEDIA MARKETPLACE — Supabase Database Schema
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- USERS
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  auth_id UUID UNIQUE,
  email TEXT UNIQUE NOT NULL,
  handle TEXT UNIQUE,
  display_name TEXT,
  role TEXT NOT NULL CHECK (role IN ('photographer','buyer','admin')),
  verified BOOLEAN DEFAULT FALSE,
  follower_count INTEGER DEFAULT 0,
  avatar_url TEXT,
  bio TEXT,
  stripe_customer_id TEXT UNIQUE,
  stripe_account_id TEXT UNIQUE,
  stripe_account_status TEXT DEFAULT 'pending',
  payout_email TEXT,
  total_earned NUMERIC(10,2) DEFAULT 0,
  total_spent NUMERIC(10,2) DEFAULT 0,
  total_sales INTEGER DEFAULT 0,
  total_wins INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- AUCTIONS
CREATE TABLE auctions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  photographer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL CHECK (category IN ('Launch Event','Test Event','Infrastructure','Breaking','Scenic','Milestone')),
  content_type TEXT NOT NULL CHECK (content_type IN ('photo','video','drone','raw')),
  exclusivity TEXT NOT NULL CHECK (exclusivity IN ('Full Exclusive','Platform Exclusive','Non-Exclusive')),
  preview_url TEXT NOT NULL,
  watermark_url TEXT,
  full_url TEXT,
  file_size_mb NUMERIC(8,2),
  duration_secs INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','closing','sold','unsold','cancelled')),
  reserve_price NUMERIC(10,2) NOT NULL,
  duration_hours INTEGER NOT NULL DEFAULT 4,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  auto_extended BOOLEAN DEFAULT FALSE,
  extension_count INTEGER DEFAULT 0,
  current_bid NUMERIC(10,2) DEFAULT 0,
  bid_count INTEGER DEFAULT 0,
  winning_bid_id UUID,
  buyer_id UUID REFERENCES users(id),
  sale_price NUMERIC(10,2),
  platform_fee NUMERIC(10,2),
  photographer_payout NUMERIC(10,2),
  rights_transferred BOOLEAN DEFAULT FALSE,
  contract_url TEXT,
  contract_signed_at TIMESTAMPTZ,
  event_tag TEXT,
  is_featured BOOLEAN DEFAULT FALSE,
  view_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- BIDS
CREATE TABLE bids (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  auction_id UUID NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  bidder_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount NUMERIC(10,2) NOT NULL,
  is_proxy BOOLEAN DEFAULT FALSE,
  proxy_max NUMERIC(10,2),
  is_winning BOOLEAN DEFAULT FALSE,
  outbid_at TIMESTAMPTZ,
  outbid_notified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- WATCHLIST
CREATE TABLE watchlist (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  auction_id UUID NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, auction_id)
);

-- TRANSACTIONS
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  auction_id UUID NOT NULL REFERENCES auctions(id),
  buyer_id UUID NOT NULL REFERENCES users(id),
  photographer_id UUID NOT NULL REFERENCES users(id),
  gross_amount NUMERIC(10,2) NOT NULL,
  platform_fee NUMERIC(10,2) NOT NULL,
  photographer_payout NUMERIC(10,2) NOT NULL,
  stripe_fee NUMERIC(10,2),
  payment_intent_id TEXT UNIQUE,
  payment_status TEXT DEFAULT 'pending' CHECK (payment_status IN ('pending','processing','succeeded','failed','refunded')),
  charge_id TEXT,
  payout_id TEXT,
  payout_status TEXT DEFAULT 'pending' CHECK (payout_status IN ('pending','in_transit','paid','failed')),
  payout_initiated_at TIMESTAMPTZ,
  payout_completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- NOTIFICATIONS
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('new_listing','outbid','auction_won','auction_lost','payment_received','payout_sent','auction_ending','content_approved','content_rejected')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  auction_id UUID REFERENCES auctions(id),
  read BOOLEAN DEFAULT FALSE,
  sent_sms BOOLEAN DEFAULT FALSE,
  sent_email BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- CONTENT REVIEWS
CREATE TABLE content_reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  auction_id UUID NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  reviewer_id UUID REFERENCES users(id),
  decision TEXT NOT NULL CHECK (decision IN ('approved','rejected','flagged')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- INDEXES
CREATE INDEX idx_auctions_status ON auctions(status);
CREATE INDEX idx_auctions_ends_at ON auctions(ends_at);
CREATE INDEX idx_auctions_category ON auctions(category);
CREATE INDEX idx_bids_auction ON bids(auction_id);
CREATE INDEX idx_bids_bidder ON bids(bidder_id);
CREATE INDEX idx_watchlist_user ON watchlist(user_id);
CREATE INDEX idx_notifications_user ON notifications(user_id, read);

-- RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE auctions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_read_own" ON users FOR SELECT USING (auth.uid() = auth_id);
CREATE POLICY "users_update_own" ON users FOR UPDATE USING (auth.uid() = auth_id);
CREATE POLICY "auctions_public_read" ON auctions FOR SELECT USING (status = 'active' OR photographer_id IN (SELECT id FROM users WHERE auth_id = auth.uid()));
CREATE POLICY "auctions_insert_own" ON auctions FOR INSERT WITH CHECK (photographer_id IN (SELECT id FROM users WHERE auth_id = auth.uid()));
CREATE POLICY "bids_read" ON bids FOR SELECT USING (bidder_id IN (SELECT id FROM users WHERE auth_id = auth.uid()));
CREATE POLICY "bids_insert" ON bids FOR INSERT WITH CHECK (bidder_id IN (SELECT id FROM users WHERE auth_id = auth.uid()));
CREATE POLICY "watchlist_own" ON watchlist FOR ALL USING (user_id IN (SELECT id FROM users WHERE auth_id = auth.uid()));
CREATE POLICY "notifications_own" ON notifications FOR ALL USING (user_id IN (SELECT id FROM users WHERE auth_id = auth.uid()));
CREATE POLICY "transactions_own" ON transactions FOR SELECT USING (buyer_id IN (SELECT id FROM users WHERE auth_id = auth.uid()) OR photographer_id IN (SELECT id FROM users WHERE auth_id = auth.uid()));

-- AUTO-UPDATED_AT TRIGGER
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_auctions_updated BEFORE UPDATE ON auctions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_transactions_updated BEFORE UPDATE ON transactions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ON AUCTION SOLD: UPDATE USER TOTALS
CREATE OR REPLACE FUNCTION on_auction_sold() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'sold' AND OLD.status != 'sold' THEN
    UPDATE users SET total_earned = total_earned + NEW.photographer_payout, total_sales = total_sales + 1 WHERE id = NEW.photographer_id;
    UPDATE users SET total_spent = total_spent + NEW.sale_price, total_wins = total_wins + 1 WHERE id = NEW.buyer_id;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_auction_sold AFTER UPDATE ON auctions FOR EACH ROW EXECUTE FUNCTION on_auction_sold();

-- ── ATTESTATIONS (append to schema or run attestation_migration.sql) ──
-- See supabase/attestation_migration.sql for full attestation schema
-- including immutability triggers and audit view.

-- ── BUYER APPLICATIONS ────────────────────────────────────────────────────
CREATE TABLE buyer_applications (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,
  email           TEXT NOT NULL,
  channel_name    TEXT NOT NULL,
  content_focus   TEXT,
  note            TEXT,
  platforms       JSONB NOT NULL DEFAULT '[]',  -- [{name, url, followers}]
  total_followers INTEGER GENERATED ALWAYS AS (
    COALESCE((
      SELECT SUM((p->>'followers')::INTEGER)
      FROM jsonb_array_elements(platforms) p
      WHERE p->>'followers' ~ '^\d+$'
    ), 0)
  ) STORED,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected')),
  reviewed_by     UUID REFERENCES users(id),
  reviewed_at     TIMESTAMPTZ,
  review_note     TEXT,
  invite_token    TEXT UNIQUE,    -- secure token for direct invite links
  invite_sent_at  TIMESTAMPTZ,
  ip_address      TEXT,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_buyer_apps_status ON buyer_applications(status);
CREATE INDEX idx_buyer_apps_email  ON buyer_applications(email);

ALTER TABLE buyer_applications ENABLE ROW LEVEL SECURITY;
-- Applications are insert-only from public; admins read/update all
CREATE POLICY "buyer_apps_insert_public" ON buyer_applications
  FOR INSERT WITH CHECK (true);
CREATE POLICY "buyer_apps_admin_all" ON buyer_applications
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin')
  );

CREATE TRIGGER trg_buyer_apps_updated
  BEFORE UPDATE ON buyer_applications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
