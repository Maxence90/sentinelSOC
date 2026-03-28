import { Logger } from '../../utils/logger';
import { TransactionService } from '../transactionService';
import { closeDatabase, getPool } from './connection';
import { initializeDatabase } from './schema';

const logger = new Logger('DatabaseDemo');

export async function runDatabaseDemo(): Promise<void> {
  try {
    logger.info('\n=== PostgreSQL Database Demo ===\n');
    await initializeDatabase();

    const service = new TransactionService();
    const result = await service.saveAnalysisResult({
      transaction: {
        txHash: '0x' + '1'.repeat(64),
        chainId: '11155111',
        from: '0x' + '2'.repeat(40),
        to: '0x' + '3'.repeat(40),
        valueWei: '1500000000000000000',
        protocol: 'Uniswap V3',
        methodName: 'exactInputSingle(address,address,uint256)',
        methodSignature: '0x414bf389',
        callDataBytes: 132,
        parsedParameters: {
          amountIn: '1000000000000000000',
          amountOutMinimum: '900000000000000000',
        },
        riskScore: 25,
        isRisky: false,
        riskReason: null,
      },
      riskHits: [
        {
          ruleName: 'known_protocol_low_risk',
          scoreDelta: 5,
          reason: 'Known protocol interaction kept for explainability demo',
          evidence: { protocol: 'Uniswap V3' },
        },
      ],
      log: {
        action: 'PARSED',
        details: 'Successfully stored parsed transaction in PostgreSQL',
        metadata: { protocol: 'Uniswap V3' },
      },
    });

    const counts = await getPool().query<{
      total_transactions: string;
      total_risk_hits: string;
      total_logs: string;
    }>(`
      SELECT
        (SELECT COUNT(*) FROM transactions) AS total_transactions,
        (SELECT COUNT(*) FROM risk_hits) AS total_risk_hits,
        (SELECT COUNT(*) FROM transaction_logs) AS total_logs
    `);

    logger.info(`Stored transaction ID: ${result.transaction.id}`);
    logger.info(`Stored risk hits: ${result.riskHits.length}`);
    logger.info(`Stored log ID: ${result.log.id}`);
    logger.info(`Total transactions: ${counts.rows[0].total_transactions}`);
    logger.info(`Total risk hits: ${counts.rows[0].total_risk_hits}`);
    logger.info(`Total logs: ${counts.rows[0].total_logs}`);
    logger.info('✅ PostgreSQL demo completed successfully');
  } catch (error) {
    logger.error('Demo error', error);
    throw error;
  } finally {
    await closeDatabase();
  }
}