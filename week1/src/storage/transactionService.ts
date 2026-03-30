import { Pool, PoolClient } from 'pg';
import { Logger } from '../utils/logger';
import { getPool } from './db/connection';
import {
  AnalysisPersistenceResult,
  RiskHit,
  RiskHitInput,
  SaveAnalysisResultInput,
  SaveTransactionInput,
  StoredLog,
  StoredTransaction,
  TransactionLogInput,
} from './db/types';

const logger = new Logger('TransactionService');

type QueryExecutor = Pool | PoolClient;

type TransactionRow = {
  id: number;
  tx_hash: string;
  chain_id: string;
  from_address: string;
  to_address: string | null;
  value_wei: string;
  protocol: string;
  method_name: string | null;
  method_signature: string | null;
  call_data_bytes: number;
  parsed_parameters: Record<string, unknown> | null;
  risk_score: number;
  is_risky: boolean;
  risk_reason: string | null;
  created_at: Date;
  updated_at: Date;
};

type LogRow = {
  id: number;
  transaction_id: number;
  action: string;
  details: string;
  metadata: Record<string, unknown> | null;
  processed_at: Date;
};

type RiskHitRow = {
  id: number;
  transaction_id: number;
  dedupe_key: string;
  rule_name: string;
  score_delta: number;
  reason: string;
  evidence: Record<string, unknown> | null;
  created_at: Date;
};

function mapTransactionRow(row: TransactionRow): StoredTransaction {
  return {
    id: row.id,
    txHash: row.tx_hash,
    chainId: row.chain_id,
    from: row.from_address,
    to: row.to_address,
    valueWei: row.value_wei,
    protocol: row.protocol,
    methodName: row.method_name,
    methodSignature: row.method_signature,
    callDataBytes: row.call_data_bytes,
    parsedParameters: row.parsed_parameters,
    riskScore: row.risk_score,
    isRisky: row.is_risky,
    riskReason: row.risk_reason,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapLogRow(row: LogRow): StoredLog {
  return {
    id: row.id,
    transactionId: row.transaction_id,
    action: row.action,
    details: row.details,
    metadata: row.metadata,
    processedAt: row.processed_at.toISOString(),
  };
}

function mapRiskHitRow(row: RiskHitRow): RiskHit {
  return {
    id: row.id,
    transactionId: row.transaction_id,
    dedupeKey: row.dedupe_key,
    ruleName: row.rule_name,
    scoreDelta: row.score_delta,
    reason: row.reason,
    evidence: row.evidence,
    createdAt: row.created_at.toISOString(),
  };
}

function normalizeRiskHitInput(input: RiskHitInput): Required<RiskHitInput> {
  return {
    dedupeKey: input.dedupeKey || input.ruleName,
    ruleName: input.ruleName,
    scoreDelta: input.scoreDelta,
    reason: input.reason,
    evidence: input.evidence || {},
  };
}

function normalizeTransactionInput(data: SaveTransactionInput): SaveTransactionInput {
  return {
    txHash: data.txHash,
    chainId: data.chainId || '0',
    from: data.from || '',
    to: data.to || null,
    valueWei: data.valueWei || '0',
    protocol: data.protocol || 'Unknown',
    methodName: data.methodName || null,
    methodSignature: data.methodSignature || null,
    callDataBytes: data.callDataBytes || 0,
    parsedParameters: data.parsedParameters || null,
    riskScore: data.riskScore || 0,
    isRisky: data.isRisky || false,
    riskReason: data.riskReason || null,
  };
}

export class TransactionService {
  private async upsertTransaction(executor: QueryExecutor, input: SaveTransactionInput): Promise<StoredTransaction> {
    const data = normalizeTransactionInput(input);
    const result = await executor.query<TransactionRow>(
      `
        INSERT INTO transactions (
          tx_hash,
          chain_id,
          from_address,
          to_address,
          value_wei,
          protocol,
          method_name,
          method_signature,
          call_data_bytes,
          parsed_parameters,
          risk_score,
          is_risky,
          risk_reason
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (tx_hash)
        DO UPDATE SET
          chain_id = EXCLUDED.chain_id,
          from_address = EXCLUDED.from_address,
          to_address = EXCLUDED.to_address,
          value_wei = EXCLUDED.value_wei,
          protocol = EXCLUDED.protocol,
          method_name = EXCLUDED.method_name,
          method_signature = EXCLUDED.method_signature,
          call_data_bytes = EXCLUDED.call_data_bytes,
          parsed_parameters = EXCLUDED.parsed_parameters,
          risk_score = EXCLUDED.risk_score,
          is_risky = EXCLUDED.is_risky,
          risk_reason = EXCLUDED.risk_reason,
          updated_at = NOW()
        RETURNING *
      `,
      [
        data.txHash,
        data.chainId,
        data.from,
        data.to,
        data.valueWei,
        data.protocol,
        data.methodName,
        data.methodSignature,
        data.callDataBytes,
        data.parsedParameters,
        data.riskScore,
        data.isRisky,
        data.riskReason,
      ]
    );

    return mapTransactionRow(result.rows[0]);
  }

  private async insertRiskHit(
    executor: QueryExecutor,
    transactionId: number,
    input: RiskHitInput
  ): Promise<RiskHit> {
    const data = normalizeRiskHitInput(input);
    const result = await executor.query<RiskHitRow>(
      `
        INSERT INTO risk_hits (transaction_id, dedupe_key, rule_name, score_delta, reason, evidence)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (transaction_id, dedupe_key)
        DO UPDATE SET
          rule_name = EXCLUDED.rule_name,
          score_delta = EXCLUDED.score_delta,
          reason = EXCLUDED.reason,
          evidence = EXCLUDED.evidence
        RETURNING *
      `,
      [transactionId, data.dedupeKey, data.ruleName, data.scoreDelta, data.reason, data.evidence]
    );

    return mapRiskHitRow(result.rows[0]);
  }

  private async insertLog(
    executor: QueryExecutor,
    transactionId: number,
    input: TransactionLogInput
  ): Promise<StoredLog> {
    const result = await executor.query<LogRow>(
      `
        INSERT INTO transaction_logs (transaction_id, action, details, metadata)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `,
      [transactionId, input.action, input.details, input.metadata || null]
    );

    return mapLogRow(result.rows[0]);
  }

  async saveTransaction(data: SaveTransactionInput): Promise<StoredTransaction> {
    try {
      return await this.upsertTransaction(getPool(), data);
    } catch (error) {
      logger.error('Error saving transaction', error);
      throw error;
    }
  }

  async saveAnalysisResult(input: SaveAnalysisResultInput): Promise<AnalysisPersistenceResult> {
    const client = await getPool().connect();

    try {
      await client.query('BEGIN');

      const transaction = await this.upsertTransaction(client, input.transaction);
      await client.query('DELETE FROM risk_hits WHERE transaction_id = $1', [transaction.id]);
      await client.query('DELETE FROM transaction_logs WHERE transaction_id = $1', [transaction.id]);

      const riskHits: RiskHit[] = [];

      for (const hit of input.riskHits) {
        riskHits.push(await this.insertRiskHit(client, transaction.id, hit));
      }

      const log = await this.insertLog(client, transaction.id, input.log);

      await client.query('COMMIT');

      return {
        transaction,
        riskHits,
        log,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error saving analysis result', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getTransaction(txHash: string): Promise<StoredTransaction | null> {
    const result = await getPool().query<TransactionRow>('SELECT * FROM transactions WHERE tx_hash = $1', [txHash]);
    return result.rows[0] ? mapTransactionRow(result.rows[0]) : null;
  }

  async addRiskHit(
    transactionId: number,
    ruleName: string,
    scoreDelta: number,
    reason: string,
    evidence?: Record<string, unknown>,
    dedupeKey?: string
  ): Promise<RiskHit> {
    try {
      return await this.insertRiskHit(getPool(), transactionId, { dedupeKey, ruleName, scoreDelta, reason, evidence });
    } catch (error) {
      logger.error('Error adding risk hit', error);
      throw error;
    }
  }

  async addLog(
    transactionId: number,
    action: string,
    details: string,
    metadata?: Record<string, unknown>
  ): Promise<StoredLog> {
    try {
      return await this.insertLog(getPool(), transactionId, { action, details, metadata });
    } catch (error) {
      logger.error('Error adding log', error);
      throw error;
    }
  }

  async getRiskyTransactions(limit: number = 100): Promise<StoredTransaction[]> {
    const result = await getPool().query<TransactionRow>(
      `
        SELECT *
        FROM transactions
        WHERE is_risky = TRUE
        ORDER BY risk_score DESC, created_at DESC
        LIMIT $1
      `,
      [limit]
    );

    return result.rows.map(mapTransactionRow);
  }

  async getTransactionsByProtocol(protocol: string, limit: number = 50): Promise<StoredTransaction[]> {
    const result = await getPool().query<TransactionRow>(
      `
        SELECT *
        FROM transactions
        WHERE protocol = $1
        ORDER BY created_at DESC
        LIMIT $2
      `,
      [protocol, limit]
    );

    return result.rows.map(mapTransactionRow);
  }

  async getTransactionsByAddress(address: string, limit: number = 50): Promise<StoredTransaction[]> {
    const loweredAddress = address.toLowerCase();
    const result = await getPool().query<TransactionRow>(
      `
        SELECT *
        FROM transactions
        WHERE LOWER(from_address) = $1 OR LOWER(COALESCE(to_address, '')) = $1
        ORDER BY created_at DESC
        LIMIT $2
      `,
      [loweredAddress, limit]
    );

    return result.rows.map(mapTransactionRow);
  }

  async getStatistics(): Promise<{
    totalTransactions: number;
    riskyTransactions: number;
    uniqueProtocols: number;
    riskScoreDistribution: Record<string, number>;
  }> {
    const result = await getPool().query<{
      total_transactions: string;
      risky_transactions: string;
      unique_protocols: string;
      bucket_0_10: string;
      bucket_10_30: string;
      bucket_30_50: string;
      bucket_50_70: string;
      bucket_70_plus: string;
    }>(
      `
        SELECT
          COUNT(*) AS total_transactions,
          COUNT(*) FILTER (WHERE is_risky = TRUE) AS risky_transactions,
          COUNT(DISTINCT protocol) AS unique_protocols,
          COUNT(*) FILTER (WHERE risk_score < 10) AS bucket_0_10,
          COUNT(*) FILTER (WHERE risk_score >= 10 AND risk_score < 30) AS bucket_10_30,
          COUNT(*) FILTER (WHERE risk_score >= 30 AND risk_score < 50) AS bucket_30_50,
          COUNT(*) FILTER (WHERE risk_score >= 50 AND risk_score < 70) AS bucket_50_70,
          COUNT(*) FILTER (WHERE risk_score >= 70) AS bucket_70_plus
        FROM transactions
      `
    );

    const row = result.rows[0];
    return {
      totalTransactions: Number(row.total_transactions || 0),
      riskyTransactions: Number(row.risky_transactions || 0),
      uniqueProtocols: Number(row.unique_protocols || 0),
      riskScoreDistribution: {
        '0-10': Number(row.bucket_0_10 || 0),
        '10-30': Number(row.bucket_10_30 || 0),
        '30-50': Number(row.bucket_30_50 || 0),
        '50-70': Number(row.bucket_50_70 || 0),
        '70+': Number(row.bucket_70_plus || 0),
      },
    };
  }

  async deleteOldTransactions(daysToKeep: number = 7): Promise<number> {
    try {
      const result = await getPool().query<{ id: number }>(
        `
          DELETE FROM transactions
          WHERE created_at < NOW() - ($1 * INTERVAL '1 day')
          RETURNING id
        `,
        [daysToKeep]
      );

      logger.info(`Deleted ${result.rowCount || 0} old transactions`);
      return result.rowCount || 0;
    } catch (error) {
      logger.error('Error deleting old transactions', error);
      throw error;
    }
  }

  async detectRiskPatterns(): Promise<Map<string, number>> {
    const patterns = new Map<string, number>();

    const frequentRiskyAddresses = await getPool().query<{ from_address: string; risky_count: string }>(
      `
        SELECT from_address, COUNT(*) AS risky_count
        FROM transactions
        WHERE is_risky = TRUE
        GROUP BY from_address
        HAVING COUNT(*) > 2
      `
    );

    frequentRiskyAddresses.rows.forEach((row) => {
      patterns.set(`FrequentRiskyAddress_${row.from_address}`, Number(row.risky_count));
    });

    const highRiskProtocols = await getPool().query<{ protocol: string; risk_rate: string }>(
      `
        SELECT
          protocol,
          ROUND((COUNT(*) FILTER (WHERE is_risky = TRUE)::numeric / COUNT(*)) * 100) AS risk_rate
        FROM transactions
        GROUP BY protocol
        HAVING COUNT(*) > 0 AND (COUNT(*) FILTER (WHERE is_risky = TRUE)::numeric / COUNT(*)) > 0.3
      `
    );

    highRiskProtocols.rows.forEach((row) => {
      patterns.set(`HighRiskProtocol_${row.protocol}`, Number(row.risk_rate));
    });

    return patterns;
  }
}