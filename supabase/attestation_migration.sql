-- ============================================================
-- RRMM — Attestation Migration
-- Run in Supabase SQL Editor after initial schema.sql
-- ============================================================

-- ── Standalone attestations table ───────────────────────────
-- Every submission gets a permanent, timestamped record of
-- exactly what the photographer warranted and when.
CREATE TABLE attestations (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  auction_id          UUID NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  photographer_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- The four checkbox warranties (each stored individually)
  confirmed_ownership     BOOLEAN NOT NULL DEFAULT FALSE,  -- "I own this content"
  confirmed_unpublished   BOOLEAN NOT NULL DEFAULT FALSE,  -- "Not shared on any platform"
  confirmed_no_third_party BOOLEAN NOT NULL DEFAULT FALSE, -- "No third-party rights"
  confirmed_consequences  BOOLEAN NOT NULL DEFAULT FALSE,  -- "I understand false claims"

  -- All four must be TRUE for a valid attestation
  -- Enforced at API layer and here as a check constraint
  CONSTRAINT all_boxes_checked CHECK (
    confirmed_ownership = TRUE AND
    confirmed_unpublished = TRUE AND
    confirmed_no_third_party = TRUE AND
    confirmed_consequences = TRUE
  ),

  -- Immutable audit fields — never updated after insert
  attested_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address          TEXT,        -- captured server-side from req headers
  user_agent          TEXT,        -- browser/device fingerprint
  session_id          TEXT,        -- Supabase auth session ID at time of attestation

  -- Legal text snapshot — store exact wording shown to user at time of signing
  -- so there's no ambiguity if terms change later
  attestation_version TEXT NOT NULL DEFAULT 'v1.0',
  legal_text_snapshot TEXT NOT NULL DEFAULT
    'v1.0: (1) I own this content and hold all rights. (2) This content has not been posted on any public platform or social media. (3) No third-party rights restrict my ability to sell it. (4) I understand that false claims constitute a breach of RRMM Terms of Service and may result in legal liability.'
);

-- ── Add attestation reference to auctions table ──────────────
ALTER TABLE auctions
  ADD COLUMN attestation_id UUID REFERENCES attestations(id),
  ADD COLUMN attested_at    TIMESTAMPTZ;

-- ── Index for fast lookup ────────────────────────────────────
CREATE INDEX idx_attestations_auction      ON attestations(auction_id);
CREATE INDEX idx_attestations_photographer ON attestations(photographer_id);
CREATE INDEX idx_attestations_attested_at  ON attestations(attested_at);

-- ── RLS: photographers see own; admins see all ───────────────
ALTER TABLE attestations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "attestations_read_own" ON attestations
  FOR SELECT USING (
    photographer_id IN (SELECT id FROM users WHERE auth_id = auth.uid())
  );

-- Attestations are INSERT-only — never updated or deleted
CREATE POLICY "attestations_insert_own" ON attestations
  FOR INSERT WITH CHECK (
    photographer_id IN (SELECT id FROM users WHERE auth_id = auth.uid())
  );

-- ── Trigger: prevent any UPDATE or DELETE on attestations ────
-- Once recorded, an attestation is immutable.
CREATE OR REPLACE FUNCTION block_attestation_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Attestation records are immutable and cannot be modified or deleted.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_no_attestation_update
  BEFORE UPDATE ON attestations
  FOR EACH ROW EXECUTE FUNCTION block_attestation_mutation();

CREATE TRIGGER trg_no_attestation_delete
  BEFORE DELETE ON attestations
  FOR EACH ROW EXECUTE FUNCTION block_attestation_mutation();

-- ── View: admin audit log ────────────────────────────────────
CREATE VIEW attestation_audit_log AS
  SELECT
    a.id               AS attestation_id,
    au.title           AS auction_title,
    au.category,
    u.handle           AS photographer_handle,
    u.email            AS photographer_email,
    a.attested_at,
    a.ip_address,
    a.user_agent,
    a.attestation_version,
    a.confirmed_ownership,
    a.confirmed_unpublished,
    a.confirmed_no_third_party,
    a.confirmed_consequences,
    au.sale_price,
    au.status          AS auction_status
  FROM attestations a
  JOIN auctions au ON au.id = a.auction_id
  JOIN users u     ON u.id  = a.photographer_id
  ORDER BY a.attested_at DESC;
