import 'dotenv/config';
import { ethers } from 'ethers';
import { TransactionParser, ParsedTransaction } from '../parsers/transactionParser';
import { TransactionService } from '../storage/transactionService';
import { closeDatabase } from '../storage/db/connection';
import { initializeDatabase } from '../storage/db/schema';
import { Logger } from '../utils/logger';

const logger = new Logger('IntegratedMonitor');

interface EvaluatedRiskHit {
  ruleName: string;
  scoreDelta: number;
  reason: string;
  evidence?: Record<string, unknown>;
}

export class IntegratedTransactionMonitor {
  private parser: TransactionParser;
  private service: TransactionService;
  private provider: ethers.WebSocketProvider;
  private processedCount: number = 0;

  constructor(wsUrl: string, httpUrl: string) {
    this.provider = new ethers.WebSocketProvider(wsUrl);
    this.parser = new TransactionParser(httpUrl);
    this.service = new TransactionService();
  }

  async start(): Promise<void> {
    try {
      await initializeDatabase();

      const network = await this.provider.getNetwork();
      logger.info(`Connected to ${network.name}`);

      this.startListening();

      setInterval(() => {
        void this.printStats();
      }, 60000);
    } catch (error) {
      logger.error('Failed to start monitor', error);
      throw error;
    }
  }

  private startListening(): void {
    logger.info('👂 Starting integrated transaction monitoring...');

    this.provider.on('pending', async (txHash: string) => {
      try {
        this.processedCount++;

        const parsed = await this.parser.parseTransaction(txHash);
        if (!parsed) {
          logger.debug('Failed to parse transaction', { txHash });
          return;
        }

        const riskHits = this.evaluateRiskHits(parsed);
        const riskScore = Math.min(riskHits.reduce((total, hit) => total + hit.scoreDelta, 0), 100);
        const isRisky = riskScore >= 30;

        await this.service.saveAnalysisResult({
          transaction: {
            txHash: parsed.txHash,
            chainId: parsed.chainId,
            from: parsed.from,
            to: parsed.to,
            valueWei: parsed.valueWei,
            protocol: parsed.protocol,
            methodName: parsed.methodName,
            methodSignature: parsed.methodSignature,
            callDataBytes: parsed.callDataBytes,
            parsedParameters: parsed.parameters,
            riskScore,
            isRisky,
            riskReason: this.getRiskReason(parsed) || null,
          },
          riskHits,
          log: {
            action: isRisky ? 'ANALYZED' : 'PARSED',
            details: `Detected ${parsed.protocol} transaction: ${parsed.methodName}`,
            metadata: {
              protocol: parsed.protocol,
              riskScore,
              isRisky,
            },
          },
        });

        const status = isRisky ? '⚠️  [RISKY]' : '✅';
        logger.info(`${status} #${this.processedCount} - ${parsed.protocol}: ${parsed.methodName} (Risk: ${riskScore})`);
      } catch (error) {
        logger.warn('Error processing transaction', { txHash, error: String(error) });
      }
    });

    process.on('SIGINT', async () => {
      logger.info('\n👋 Shutting down...');
      this.provider.removeAllListeners();
      await this.printStats();
      await closeDatabase();
      process.exit(0);
    });
  }

  private evaluateRiskHits(parsed: ParsedTransaction): EvaluatedRiskHit[] {
    const hits: EvaluatedRiskHit[] = [];
    const highRiskProtocols = ['1inch Router', 'Unknown'];

    if (highRiskProtocols.includes(parsed.protocol)) {
      hits.push({
        ruleName: 'high_risk_protocol',
        scoreDelta: 20,
        reason: `Protocol ${parsed.protocol} is treated as high risk in the MVP rules`,
        evidence: { protocol: parsed.protocol },
      });
    }

    const riskyMethods = ['approve', 'transferFrom', 'permit', 'swap', 'flashLoan'];
    if (parsed.methodName && riskyMethods.some((method) => parsed.methodName?.includes(method))) {
      hits.push({
        ruleName: 'risky_method_detected',
        scoreDelta: 15,
        reason: `Method ${parsed.methodName} matched risky method keywords`,
        evidence: { methodName: parsed.methodName },
      });
    }

    if (parseFloat(parsed.valueEth) > 10) {
      hits.push({
        ruleName: 'large_value_transfer',
        scoreDelta: 10,
        reason: 'Transaction value exceeded the 10 ETH MVP threshold',
        evidence: { valueEth: parsed.valueEth, valueWei: parsed.valueWei },
      });
    }

    if (parsed.to === '0x0000000000000000000000000000000000000000') {
      hits.push({
        ruleName: 'contract_creation_detected',
        scoreDelta: 25,
        reason: 'Contract creation is treated as higher risk in the MVP ruleset',
        evidence: { to: parsed.to },
      });
    }

    return hits;
  }

  private getRiskReason(parsed: ParsedTransaction): string {
    const reasons: string[] = [];

    if (parsed.methodName?.includes('approve')) {
      reasons.push('ERC20 approval detected');
    }
    if (parsed.protocol === '1inch Router') {
      reasons.push('Multi-protocol aggregator');
    }
    if (parseFloat(parsed.valueEth) > 10) {
      reasons.push('Large ETH value transfer');
    }

    return reasons.join('; ');
  }

  private async printStats(): Promise<void> {
    const stats = await this.service.getStatistics();
    const patterns = await this.service.detectRiskPatterns();
    const riskyRatio = Math.round((stats.riskyTransactions / stats.totalTransactions) * 100 || 0);

    logger.info('\n=== System Statistics ===');
    logger.info(`Total transactions processed: ${stats.totalTransactions}`);
    logger.info(`Risky transactions: ${stats.riskyTransactions} (${riskyRatio}%)`);
    logger.info(`Unique protocols: ${stats.uniqueProtocols}`);
    logger.info('\nRisk Score Distribution:', stats.riskScoreDistribution);

    if (patterns.size > 0) {
      logger.warn('\n⚠️  Detected Risk Patterns:');
      patterns.forEach((count, pattern) => {
        logger.warn(`  - ${pattern}: ${count}`);
      });
    }

    logger.info('===========================\n');
  }
}

export async function runIntegratedMonitor(): Promise<void> {
  const wsUrl = process.env.INFURA_WS_URL || process.env.ALCHEMY_WS_URL;
  const httpUrl = process.env.INFURA_HTTP_URL;

  if (!wsUrl || !httpUrl) {
    logger.error('❌ Missing configuration: INFURA_WS_URL and INFURA_HTTP_URL required');
    process.exit(1);
  }

  const monitor = new IntegratedTransactionMonitor(wsUrl, httpUrl);
  await monitor.start();
}