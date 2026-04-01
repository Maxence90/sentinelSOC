//集成：以太坊交易池监听器升级版，集成了解析、存储、评分等完整能力
import 'dotenv/config';
import { ethers } from 'ethers';
import { createRiskNotifier, RiskNotifier } from '../notifications';
import { TransactionParser, ParsedTransaction } from '../parsers/transactionParser';
import { LocalRulesScorer, RiskScorer } from './rules';
import { TransactionService } from '../storage/transactionService';
import { closeDatabase } from '../storage/db/connection';
import { initializeDatabase } from '../storage/db/schema';
import { Logger } from '../utils/logger';

const logger = new Logger('IntegratedMonitor');

export class IntegratedTransactionMonitor {
  private parser: TransactionParser;
  private scorer: RiskScorer;
  private service: TransactionService;
  private notifier: RiskNotifier;
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
  constructor(
    wsUrl: string,
    httpUrl: string,
    scorer: RiskScorer = new LocalRulesScorer(),
    notifier: RiskNotifier = createRiskNotifier(),
  ) {
    this.provider = new ethers.WebSocketProvider(wsUrl);//用于实时监听
    this.parser = new TransactionParser(httpUrl);//用于有效查询
    this.scorer = scorer;
    this.service = new TransactionService();
    this.notifier = notifier;
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

      const evaluation = this.scorer.evaluate(parsed);

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
          riskScore: evaluation.riskScore,
          isRisky: evaluation.isRisky,
          riskReason: evaluation.riskReason,
        },
        riskHits: evaluation.riskHits,
        log: {
          action: evaluation.isRisky ? 'ANALYZED' : 'PARSED',
          details: `Detected ${parsed.protocol} transaction: ${parsed.methodName}`,
          metadata: {
            protocol: parsed.protocol,
            riskScore: evaluation.riskScore,
            isRisky: evaluation.isRisky,
          },
        },
      });

      if (evaluation.isRisky) {
        void this.notifier.notifyRiskEvent({
          txHash: parsed.txHash,
          chainId: parsed.chainId,
          protocol: parsed.protocol,
          methodName: parsed.methodName,
          from: parsed.from,
          to: parsed.to,
          valueEth: parsed.valueEth,
          valueWei: parsed.valueWei,
          riskScore: evaluation.riskScore,
          riskReason: evaluation.riskReason,
          riskHits: evaluation.riskHits,
          detectedAt: new Date().toISOString(),
        }).catch((error) => {
          logger.warn('Failed to send risk alert', { txHash, error: String(error) });
        });
      }

      this.processedCount++;
      const status = evaluation.isRisky ? '⚠️  [RISKY]' : '✅';
      logger.info(`${status} #${this.processedCount} - ${parsed.protocol}: ${parsed.methodName} (Risk: ${evaluation.riskScore})`);
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

export interface IntegratedMonitorBootstrapOptions {
  wsUrl: string;
  httpUrl: string;
  scorer?: RiskScorer;
}

/**
 * 从环境变量读取配置并启动一体化监控流程。
 */
export async function runIntegratedMonitor(options?: IntegratedMonitorBootstrapOptions): Promise<void> {
  const wsUrl = options?.wsUrl || process.env.INFURA_WS_URL || process.env.ALCHEMY_WS_URL;
  const httpUrl = options?.httpUrl || process.env.INFURA_HTTP_URL;

  if (!wsUrl || !httpUrl) {
    logger.error('❌ Missing configuration: websocket and http RPC URLs are required');
    process.exit(1);
  }

  const monitor = new IntegratedTransactionMonitor(wsUrl, httpUrl, options?.scorer);
  await monitor.start();
}