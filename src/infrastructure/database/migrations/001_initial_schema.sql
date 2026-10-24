-- Migration 001: Initial Schema
-- Enforces uniqueness, immutability, non-negativity and exact ledger arithmetic

-- 1. Wallets table
CREATE TABLE IF NOT EXISTS wallets (
  id VARCHAR(36) PRIMARY KEY,
  player_id VARCHAR(64) NOT NULL,
  currency VARCHAR(3) NOT NULL,
  balance NUMERIC(18, 2) NOT NULL,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_wallets_player_currency UNIQUE (player_id, currency),
  CONSTRAINT chk_wallets_balance_non_negative CHECK (balance >= 0),
  CONSTRAINT chk_wallets_version_positive CHECK (version >= 1)
);

CREATE INDEX IF NOT EXISTS idx_wallets_player_currency ON wallets (player_id, currency);

-- 2. Wager Transactions table
CREATE TABLE IF NOT EXISTS wager_transactions (
  id VARCHAR(36) PRIMARY KEY,
  provider_id VARCHAR(64) NOT NULL,
  external_transaction_id VARCHAR(128) NOT NULL,
  idempotency_key VARCHAR(256) NOT NULL,
  payload_hash VARCHAR(64) NOT NULL,
  wallet_id VARCHAR(36) NOT NULL REFERENCES wallets(id),
  player_id VARCHAR(64) NOT NULL,
  round_id VARCHAR(128) NOT NULL,
  game_id VARCHAR(128) NOT NULL,
  kind VARCHAR(20) NOT NULL,
  amount NUMERIC(18, 2) NOT NULL,
  currency VARCHAR(3) NOT NULL,
  reference_external_transaction_id VARCHAR(128) NULL,
  reference_transaction_id VARCHAR(36) NULL REFERENCES wager_transactions(id),
  status VARCHAR(30) NOT NULL,
  failure_code VARCHAR(50) NULL,
  processed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_wager_tx_provider_external UNIQUE (provider_id, external_transaction_id),
  CONSTRAINT uq_wager_tx_idempotency_key UNIQUE (idempotency_key),
  CONSTRAINT chk_wager_tx_amount_positive CHECK (amount >= 0)
);

CREATE INDEX IF NOT EXISTS idx_wager_tx_wallet_created ON wager_transactions (wallet_id, created_at);
CREATE INDEX IF NOT EXISTS idx_wager_tx_pending_ref ON wager_transactions (status) WHERE status = 'PENDING_REFERENCE';
CREATE INDEX IF NOT EXISTS idx_wager_tx_ref_lookup ON wager_transactions (provider_id, reference_external_transaction_id);

-- 3. Wallet Ledger Entries table
CREATE TABLE IF NOT EXISTS wallet_ledger_entries (
  id VARCHAR(36) PRIMARY KEY,
  wallet_id VARCHAR(36) NOT NULL REFERENCES wallets(id),
  transaction_id VARCHAR(36) NOT NULL REFERENCES wager_transactions(id),
  direction VARCHAR(10) NOT NULL,
  amount NUMERIC(18, 2) NOT NULL,
  currency VARCHAR(3) NOT NULL,
  balance_before NUMERIC(18, 2) NOT NULL,
  balance_after NUMERIC(18, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_ledger_wallet_transaction UNIQUE (wallet_id, transaction_id),
  CONSTRAINT chk_ledger_amount_positive CHECK (amount >= 0),
  CONSTRAINT chk_ledger_balance_before_non_negative CHECK (balance_before >= 0),
  CONSTRAINT chk_ledger_balance_after_non_negative CHECK (balance_after >= 0),
  CONSTRAINT chk_ledger_balance_math CHECK (
    (direction = 'DEBIT' AND balance_after = balance_before - amount) OR
    (direction = 'CREDIT' AND balance_after = balance_before + amount)
  )
);

CREATE INDEX IF NOT EXISTS idx_ledger_wallet_created ON wallet_ledger_entries (wallet_id, created_at);

-- Ledger Immutability Trigger (Rule 5: Never overwrite or delete ledger entries)
CREATE OR REPLACE FUNCTION prevent_ledger_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Ledger entries are strictly immutable and cannot be updated or deleted.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_ledger_update ON wallet_ledger_entries;
CREATE TRIGGER trg_prevent_ledger_update
BEFORE UPDATE OR DELETE ON wallet_ledger_entries
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();

-- 4. Inbox Messages table
CREATE TABLE IF NOT EXISTS inbox_messages (
  message_id VARCHAR(128) NOT NULL,
  consumer_name VARCHAR(64) NOT NULL,
  payload_hash VARCHAR(64) NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ NULL,
  PRIMARY KEY (consumer_name, message_id)
);

-- 5. Outbox Messages table
CREATE TABLE IF NOT EXISTS outbox_messages (
  id VARCHAR(36) PRIMARY KEY,
  aggregate_id VARCHAR(64) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  payload JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_outbox_due ON outbox_messages (published_at, next_attempt_at) WHERE published_at IS NULL;
