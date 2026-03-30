import { Logger } from '../../utils/logger';
import { getPool } from './connection';

const logger = new Logger('DatabaseSchema');

export async function initializeDatabase(): Promise<void> {
  const pool = getPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id BIGSERIAL PRIMARY KEY,
      tx_hash VARCHAR(66) NOT NULL UNIQUE,
      chain_id BIGINT NOT NULL DEFAULT 0,
      from_address VARCHAR(42) NOT NULL,
      to_address VARCHAR(42),
      value_wei NUMERIC(78, 0) NOT NULL DEFAULT 0,
      protocol VARCHAR(64) NOT NULL DEFAULT 'Unknown',
      method_name VARCHAR(128),
      method_signature VARCHAR(32),
      call_data_bytes INTEGER NOT NULL DEFAULT 0,
      parsed_parameters JSONB,
      risk_score INTEGER NOT NULL DEFAULT 0,
      is_risky BOOLEAN NOT NULL DEFAULT FALSE,
      risk_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'transactions' AND column_name = 'value_eth'
      ) THEN
        IF NOT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'transactions' AND column_name = 'value_wei'
        ) THEN
          ALTER TABLE transactions ADD COLUMN value_wei NUMERIC(78, 0);
        END IF;

        UPDATE transactions
        SET value_wei = COALESCE(value_wei, FLOOR(value_eth * 1000000000000000000))
        WHERE value_wei IS NULL;

        ALTER TABLE transactions ALTER COLUMN value_wei SET DEFAULT 0;
        UPDATE transactions SET value_wei = 0 WHERE value_wei IS NULL;
        ALTER TABLE transactions ALTER COLUMN value_wei SET NOT NULL;
        ALTER TABLE transactions DROP COLUMN value_eth;
      END IF;
    END $$;
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'transactions' AND column_name = 'call_data_length'
      ) AND NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'transactions' AND column_name = 'call_data_bytes'
      ) THEN
        ALTER TABLE transactions RENAME COLUMN call_data_length TO call_data_bytes;
      END IF;
    END $$;
  `);

  await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS value_wei NUMERIC(78, 0)');
  await pool.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS call_data_bytes INTEGER');
  await pool.query('UPDATE transactions SET value_wei = 0 WHERE value_wei IS NULL');
  await pool.query('UPDATE transactions SET call_data_bytes = 0 WHERE call_data_bytes IS NULL');
  await pool.query('ALTER TABLE transactions ALTER COLUMN value_wei SET DEFAULT 0');
  await pool.query('ALTER TABLE transactions ALTER COLUMN value_wei SET NOT NULL');
  await pool.query('ALTER TABLE transactions ALTER COLUMN call_data_bytes SET DEFAULT 0');
  await pool.query('ALTER TABLE transactions ALTER COLUMN call_data_bytes SET NOT NULL');
  await pool.query('ALTER TABLE transactions DROP COLUMN IF EXISTS value_eth');
  await pool.query('ALTER TABLE transactions DROP COLUMN IF EXISTS call_data_length');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS risk_hits (
      id BIGSERIAL PRIMARY KEY,
      transaction_id BIGINT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
      dedupe_key VARCHAR(128) NOT NULL,
      rule_name VARCHAR(128) NOT NULL,
      score_delta INTEGER NOT NULL,
      reason TEXT NOT NULL,
      evidence JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query('ALTER TABLE risk_hits ADD COLUMN IF NOT EXISTS dedupe_key VARCHAR(128)');
  await pool.query(`
    UPDATE risk_hits
    SET dedupe_key = rule_name
    WHERE dedupe_key IS NULL OR dedupe_key = ''
  `);
  await pool.query(`
    WITH ranked_hits AS (
      SELECT
        id,
        ROW_NUMBER() OVER (PARTITION BY transaction_id, dedupe_key ORDER BY id DESC) AS row_number
      FROM risk_hits
    )
    DELETE FROM risk_hits
    WHERE id IN (
      SELECT id
      FROM ranked_hits
      WHERE row_number > 1
    )
  `);
  await pool.query('ALTER TABLE risk_hits ALTER COLUMN dedupe_key SET NOT NULL');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS transaction_logs (
      id BIGSERIAL PRIMARY KEY,
      transaction_id BIGINT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
      action VARCHAR(32) NOT NULL,
      details TEXT NOT NULL,
      metadata JSONB,
      processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query('CREATE INDEX IF NOT EXISTS idx_transactions_from_address ON transactions (from_address)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_transactions_to_address ON transactions (to_address)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_transactions_protocol ON transactions (protocol)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_transactions_is_risky ON transactions (is_risky)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions (created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_risk_hits_transaction_id ON risk_hits (transaction_id)');
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_risk_hits_transaction_dedupe_key ON risk_hits (transaction_id, dedupe_key)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_transaction_logs_transaction_id ON transaction_logs (transaction_id)');

  logger.info('✅ PostgreSQL schema initialized');
}