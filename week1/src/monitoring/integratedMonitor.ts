//集成：以太坊交易池监听器升级版，集成了解析、存储、评分等完整能力
import 'dotenv/config';
import { ethers } from 'ethers';
import { TransactionParser, ParsedTransaction } from '../parsers/transactionParser';
import { TransactionService } from '../storage/transactionService';
import { closeDatabase } from '../storage/db/connection';
import { initializeDatabase } from '../storage/db/schema';
import { Logger } from '../utils/logger';

const logger = new Logger('IntegratedMonitor');

interface EvaluatedRiskHit {
  dedupeKey: string;
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
  private receivedPendingCount: number = 0;
  private droppedPendingCount: number = 0;
  private activePendingWorkers: number = 0;
  private isShuttingDown: boolean = false;
  private readonly pendingQueue: string[] = [];
  private readonly queuedTxHashes: Set<string> = new Set();
  private statsInterval: NodeJS.Timeout | null = null;
  private readonly startupRetryAttempts: number = 4;
  private readonly startupRetryDelayMs: number = 1500;
  private readonly pendingRetryAttempts: number = 4;
  private readonly pendingRetryDelayMs: number = 500;
  private readonly pendingConcurrency: number = 2;
  private readonly maxPendingQueueSize: number = 200;

  /**
   * 初始化一体化监控器，分别准备实时监听、交易解析和持久化服务。
   */
  constructor(wsUrl: string, httpUrl: string) {
    this.provider = new ethers.WebSocketProvider(wsUrl);//用于实时监听
    this.parser = new TransactionParser(httpUrl);//用于有效查询
    this.service = new TransactionService();
  }

  /**
   * 启动监控主流程：初始化数据库、确认网络连通性、注册监听并定时输出统计信息。
   */
  async start(): Promise<void> {
    try {
      await initializeDatabase();
      const network = await this.connectWithRetry();
      await this.warmUpProviders();
      logger.info(`Connected to ${network.name}`);

      this.startListening();

      this.statsInterval = setInterval(() => {
        void this.printStats();
      }, 60000);
    } catch (error) {
      logger.error('Failed to start monitor', error);
      throw error;
    }
  }

  /**
   * 为 WebSocket 和 HTTP provider 做启动前探测与预热，降低首次调用失败概率。
   */
  private async warmUpProviders(): Promise<void> {
    await this.retryOperation(async () => {
      await this.parser.parseRecentBlock('latest', 1);
    }, 'HTTP provider warm-up', this.startupRetryAttempts, this.startupRetryDelayMs);

    logger.info('Providers warmed up');
  }

  /**
   * 在启动阶段对 WebSocket provider 的网络探测做重试，减少瞬时 RPC 波动导致的启动失败。
   */
  private async connectWithRetry(): Promise<ethers.Network> {
    return this.retryOperation(
      async () => this.provider.getNetwork(),
      'WebSocket provider startup',
      this.startupRetryAttempts,
      this.startupRetryDelayMs,
    );
  }

  /**
   * 订阅 pending 交易事件，并串联解析、风险评估、落库和退出清理逻辑。
   */
  private startListening(): void {
    logger.info('👂 Starting integrated transaction monitoring...');
    this.provider.on('pending', (txHash: string) => {
      if (!txHash || this.isShuttingDown) {
        return;
      }

      this.receivedPendingCount++;
      this.enqueuePendingTransaction(txHash);
    });

    process.on('SIGINT', async () => {
      await this.shutdown();
    });

    this.provider.on('error', (error) => {
      logger.error('Provider error', error);
    });
  }

  /**
   * 将 pending 交易放入有限队列中，避免无限并发请求压垮 RPC。
   */
  private enqueuePendingTransaction(txHash: string): void {
    if (this.queuedTxHashes.has(txHash)) {
      return;
    }

    if (this.pendingQueue.length >= this.maxPendingQueueSize) {
      this.droppedPendingCount++;

      if (this.droppedPendingCount % 25 === 0) {
        logger.warn('Pending queue is full; dropping transactions', {
          droppedPendingCount: this.droppedPendingCount,
          maxPendingQueueSize: this.maxPendingQueueSize,
        });
      }

      return;
    }

    this.queuedTxHashes.add(txHash);
    this.pendingQueue.push(txHash);
    this.drainPendingQueue();
  }

  /**
   * 按固定并发数消费 pending 队列，把 RPC 压力控制在可承受范围内。
   */
  private drainPendingQueue(): void {
    while (!this.isShuttingDown && this.activePendingWorkers < this.pendingConcurrency && this.pendingQueue.length > 0) {
      this.activePendingWorkers++;
      void this.runPendingWorker();
    }
  }

  /**
   * 循环处理队列中的交易，直到当前没有待处理任务为止。
   */
  private async runPendingWorker(): Promise<void> {
    try {
      while (!this.isShuttingDown) {
        const txHash = this.pendingQueue.shift();
        if (!txHash) {
          return;
        }

        try {
          await this.processPendingTransaction(txHash);
        } finally {
          this.queuedTxHashes.delete(txHash);
        }
      }
    } finally {
      this.activePendingWorkers--;

      if (!this.isShuttingDown && this.pendingQueue.length > 0) {
        this.drainPendingQueue();
      }
    }
  }

  /**
   * 对单笔 pending 交易执行解析、评分和持久化；总风险分在这里聚合后写入 transaction 表。
   */
  private async processPendingTransaction(txHash: string): Promise<void> {
    try {
      const parsed = await this.parsePendingTransactionWithRetry(txHash);
      if (!parsed) {
        logger.debug('Failed to parse transaction after retries', { txHash });
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

      this.processedCount++;
      const status = isRisky ? '⚠️  [RISKY]' : '✅';
      logger.info(`${status} #${this.processedCount} - ${parsed.protocol}: ${parsed.methodName} (Risk: ${riskScore})`);
    } catch (error) {
      logger.warn('Error processing transaction', { txHash, error: String(error) });
    }
  }

  /**
   * 对 pending 交易解析做有限次重试，缓解节点刚收到 hash 但尚未可查询时的瞬时失败。
   */
  private async parsePendingTransactionWithRetry(txHash: string): Promise<ParsedTransaction | null> {
    for (let attempt = 1; attempt <= this.pendingRetryAttempts; attempt++) {
      const parsed = await this.parser.parseTransaction(txHash);
      if (parsed) {
        return parsed;
      }

      if (attempt < this.pendingRetryAttempts) {
        const delayMs = this.getRetryDelay(this.pendingRetryDelayMs, attempt);
        logger.debug('Pending transaction parse retry scheduled', { txHash, attempt, delayMs });
        await this.sleep(delayMs);
      }
    }

    return null;
  }

  /**
   * 封装统一的重试逻辑，用于启动阶段的易波动 RPC 调用。
   */
  private async retryOperation<T>(
    operation: () => Promise<T>,
    operationName: string,
    maxAttempts: number,
    baseDelayMs: number,
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;

        if (attempt === maxAttempts) {
          break;
        }

        const delayMs = this.getRetryDelay(baseDelayMs, attempt);
        logger.warn(`${operationName} failed, retrying`, {
          attempt,
          maxAttempts,
          delayMs,
          error: String(error),
        });
        await this.sleep(delayMs);
      }
    }

    throw lastError;
  }

  /**
   * 生成线性退避时间，控制连续重试时的请求节奏。
   */
  private getRetryDelay(baseDelayMs: number, attempt: number): number {
    return baseDelayMs * attempt;
  }

  /**
   * 统一封装异步等待，便于重试逻辑复用。
   */
  private async sleep(delayMs: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  /**
   * 停止监听、清空定时器并释放数据库连接。
   */
  private async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    logger.info('\n👋 Shutting down...');
    this.provider.removeAllListeners();
    this.pendingQueue.length = 0;
    this.queuedTxHashes.clear();

    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }

    await this.printStats();
    await closeDatabase();
    process.exit(0);
  }

  /**
   * 按 MVP 规则为解析后的交易生成风险命中项及对应分值。
   */
  private evaluateRiskHits(parsed: ParsedTransaction): EvaluatedRiskHit[] {
    const hits: EvaluatedRiskHit[] = [];
    const highRiskProtocols = ['1inch Router', 'Unknown'];
    if (highRiskProtocols.includes(parsed.protocol)) {
      hits.push({
        dedupeKey: 'high_risk_protocol',
        ruleName: 'high_risk_protocol',
        scoreDelta: 20,
        reason: `Protocol ${parsed.protocol} is treated as high risk in the MVP rules`,
        evidence: { protocol: parsed.protocol },
      });
    }

    const riskyMethods = ['approve', 'transferFrom', 'permit', 'swap', 'flashLoan'];
    if (parsed.methodName && riskyMethods.some((method) => parsed.methodName?.includes(method))) {
      hits.push({
        dedupeKey: `risky_method_detected:${parsed.methodName}`,
        ruleName: 'risky_method_detected',
        scoreDelta: 15,
        reason: `Method ${parsed.methodName} matched risky method keywords`,
        evidence: { methodName: parsed.methodName },
      });
    }

    if (parseFloat(parsed.valueEth) > 10) {
      hits.push({
        dedupeKey: 'large_value_transfer',
        ruleName: 'large_value_transfer',
        scoreDelta: 10,
        reason: 'Transaction value exceeded the 10 ETH MVP threshold',
        evidence: { valueEth: parsed.valueEth, valueWei: parsed.valueWei },
      });
    }

    if (parsed.to === '0x0000000000000000000000000000000000000000') {
      hits.push({
        dedupeKey: 'contract_creation_detected',
        ruleName: 'contract_creation_detected',
        scoreDelta: 25,
        reason: 'Contract creation is treated as higher risk in the MVP ruleset',
        evidence: { to: parsed.to },
      });
    }

    return hits;
  }

  /**
   * 将命中的风险特征整理为可读的原因摘要，便于后续展示和审计。
   */
  private getRiskReason(parsed: ParsedTransaction): string {
    const reasons: string[] = [];

    // 这里生成的是人类可读的摘要；更完整的风险命中和分数已经由 evaluateRiskHits 负责。
    if (parsed.methodName?.includes('approve')) {
      reasons.push('ERC20 approval detected');
    }
    if (parsed.methodName?.includes('transferFrom')) {
      reasons.push('Delegated token transfer detected');
    }
    if (parsed.methodName?.includes('permit')) {
      reasons.push('Off-chain approval signature detected');
    }
    if (parsed.methodName?.includes('swap')) {
      reasons.push('Token swap detected');
    }
    if (parsed.methodName?.includes('flashLoan')) {
      reasons.push('Flash loan operation detected');
    }
    if (parsed.protocol === '1inch Router') {
      reasons.push('Multi-protocol aggregator');
    }
    if (parseFloat(parsed.valueEth) > 10) {
      reasons.push('Large ETH value transfer');
    }

    return reasons.join('; ');
  }

  /**
   * 汇总数据库中的处理统计与风险模式，并输出当前系统状态。
   */
  private async printStats(): Promise<void> {
    const stats = await this.service.getStatistics();
    const patterns = await this.service.detectRiskPatterns();
    const riskyRatio = Math.round((stats.riskyTransactions / stats.totalTransactions) * 100 || 0);
    logger.info('\n=== System Statistics ===');
    logger.info(`Pending transactions received: ${this.receivedPendingCount}`);
    logger.info(`Total transactions processed: ${stats.totalTransactions}`);
    logger.info(`Risky transactions: ${stats.riskyTransactions} (${riskyRatio}%)`);
    logger.info(`Unique protocols: ${stats.uniqueProtocols}`);
    logger.info(`Pending queue depth: ${this.pendingQueue.length}`);
    logger.info(`Dropped pending transactions: ${this.droppedPendingCount}`);
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

/**
 * 从环境变量读取配置并启动一体化监控流程。
 */
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