import 'dotenv/config';
import axios from 'axios';
import { ethers } from 'ethers';
import { ChainConfig, loadChainConfig } from '../config';
import { closeDatabase, getPool } from '../storage/db/connection';
import { Logger } from '../utils/logger';

const logger = new Logger('HealthCheck');
const REQUEST_TIMEOUT_MS = 8000;
const REQUIRED_TABLES = ['transactions', 'risk_hits', 'transaction_logs'] as const;

type CheckStatus = 'ok' | 'failed' | 'skipped';

interface HealthCheckResult {
  name: string;
  status: CheckStatus;
  durationMs: number;
  details?: Record<string, unknown>;
  error?: string;
}

async function main(): Promise<void> {
  const chainConfig = loadChainConfig();
  const results: HealthCheckResult[] = [];

  try {
    logger.info('Running health check with chain configuration', {
      chain: chainConfig.key,
      displayName: chainConfig.displayName,
      configPath: chainConfig.configPath,
      runtime: chainConfig.runtime,
    });

    results.push(await checkHttpRpc(chainConfig));
    results.push(await checkWebSocketRpc(chainConfig));
    results.push(await checkDatabase());
    results.push(await checkFeishu(chainConfig, results));
    printSummary(results);
    process.exitCode = results.some((result) => result.status === 'failed') ? 1 : 0;
  } finally {
    await closeDatabase();
  }
}

async function checkHttpRpc(chainConfig: ChainConfig): Promise<HealthCheckResult> {
  const httpUrl = chainConfig.rpc.httpUrl;
  if (!httpUrl) {
    return failedConfig(
      `HTTP RPC (${chainConfig.key})`,
      `One of ${chainConfig.rpc.httpEnvNames.join(', ')} is required`,
    );
  }

  return runCheck(`HTTP RPC (${chainConfig.key})`, async () => {
    const provider = new ethers.JsonRpcProvider(httpUrl);

    try {
      const network = await withTimeout(provider.getNetwork(), 'HTTP RPC network lookup');
      const blockNumber = await withTimeout(provider.getBlockNumber(), 'HTTP RPC block lookup');

      return {
        chain: chainConfig.key,
        network: network.name,
        chainId: network.chainId.toString(),
        blockNumber,
        envName: chainConfig.rpc.httpEnvName,
      };
    } finally {
      destroyProvider(provider);
    }
  });
}

async function checkWebSocketRpc(chainConfig: ChainConfig): Promise<HealthCheckResult> {
  const wsUrl = chainConfig.rpc.websocketUrl;
  if (!wsUrl) {
    return failedConfig(
      `WebSocket RPC (${chainConfig.key})`,
      `One of ${chainConfig.rpc.websocketEnvNames.join(', ')} is required`,
    );
  }

  return runCheck(`WebSocket RPC (${chainConfig.key})`, async () => {
    const provider = new ethers.WebSocketProvider(wsUrl);

    try {
      const network = await withTimeout(provider.getNetwork(), 'WebSocket RPC network lookup');
      const blockNumber = await withTimeout(provider.getBlockNumber(), 'WebSocket RPC block lookup');

      return {
        chain: chainConfig.key,
        network: network.name,
        chainId: network.chainId.toString(),
        blockNumber,
        envName: chainConfig.rpc.websocketEnvName,
      };
    } finally {
      destroyProvider(provider);
    }
  });
}

async function checkDatabase(): Promise<HealthCheckResult> {
  if (!process.env.DATABASE_URL) {
    return failedConfig('PostgreSQL', 'DATABASE_URL is required');
  }

  return runCheck('PostgreSQL', async () => {
    const pool = getPool();
    const connectionResult = await withTimeout(
      pool.query('SELECT current_database() AS database_name, current_schema() AS schema_name'),
      'PostgreSQL connection check',
    );
    const tableResult = await withTimeout(
      pool.query(
        `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name = ANY($1::text[])`,
        [Array.from(REQUIRED_TABLES)],
      ),
      'PostgreSQL schema check',
    );

    const existingTables = new Set(tableResult.rows.map((row) => String(row.table_name)));
    const missingTables = REQUIRED_TABLES.filter((tableName) => !existingTables.has(tableName));

    if (missingTables.length > 0) {
      throw new Error(`Missing required tables: ${missingTables.join(', ')}`);
    }

    return {
      database: connectionResult.rows[0]?.database_name ?? 'unknown',
      schema: connectionResult.rows[0]?.schema_name ?? 'unknown',
      tables: Array.from(existingTables).sort(),
    };
  });
}

async function checkFeishu(chainConfig: ChainConfig, dependencyResults: HealthCheckResult[]): Promise<HealthCheckResult> {
  const webhookUrl = process.env.FEISHU_WEBHOOK_URL;
  if (!webhookUrl) {
    return skippedCheck('Feishu webhook', 'FEISHU_WEBHOOK_URL is not configured');
  }

  return runCheck('Feishu webhook', async () => {
    await withTimeout(
      axios.post(
        webhookUrl,
        {
          msg_type: 'text',
          content: {
            text: buildFeishuHealthCheckMessage(chainConfig, dependencyResults),
          },
        },
        {
          timeout: REQUEST_TIMEOUT_MS,
        },
      ),
      'Feishu webhook delivery',
    );

    return {
      delivered: true,
    };
  });
}

async function runCheck(
  name: string,
  operation: () => Promise<Record<string, unknown>>,
): Promise<HealthCheckResult> {
  const startedAt = Date.now();

  try {
    const details = await operation();
    return {
      name,
      status: 'ok',
      durationMs: Date.now() - startedAt,
      details,
    };
  } catch (error) {
    return {
      name,
      status: 'failed',
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function failedConfig(name: string, message: string): HealthCheckResult {
  return {
    name,
    status: 'failed',
    durationMs: 0,
    error: message,
  };
}

function skippedCheck(name: string, message: string): HealthCheckResult {
  return {
    name,
    status: 'skipped',
    durationMs: 0,
    details: { reason: message },
  };
}

function buildFeishuHealthCheckMessage(chainConfig: ChainConfig, results: HealthCheckResult[]): string {
  const summaryLines = results.map((result) => {
    const suffix = result.status === 'ok'
      ? `OK (${result.durationMs}ms)`
      : result.status === 'failed'
        ? `FAILED (${result.error ?? 'unknown error'})`
        : `SKIPPED (${String(result.details?.reason ?? 'no reason')})`;

    return `${result.name}: ${suffix}`;
  });

  return [
    'SentinelSOC 健康检查',
    `链: ${chainConfig.displayName} (${chainConfig.key})`,
    `时间: ${new Date().toISOString()}`,
    ...summaryLines,
  ].join('\n');
}

function printSummary(results: HealthCheckResult[]): void {
  for (const result of results) {
    if (result.status === 'ok') {
      logger.info(`${result.name} OK`, {
        durationMs: result.durationMs,
        ...result.details,
      });
      continue;
    }

    if (result.status === 'skipped') {
      logger.warn(`${result.name} SKIPPED`, {
        durationMs: result.durationMs,
        ...result.details,
      });
      continue;
    }

    logger.error(`${result.name} FAILED`, {
      durationMs: result.durationMs,
      error: result.error,
    });
  }

  const summary = {
    ok: results.filter((result) => result.status === 'ok').length,
    failed: results.filter((result) => result.status === 'failed').length,
    skipped: results.filter((result) => result.status === 'skipped').length,
  };

  if (summary.failed > 0) {
    logger.error('Health check completed with failures', summary);
    return;
  }

  logger.info('Health check completed', summary);
}

function destroyProvider(provider: { destroy?: () => void }): void {
  if (typeof provider.destroy === 'function') {
    provider.destroy();
  }
}

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${REQUEST_TIMEOUT_MS}ms`));
    }, REQUEST_TIMEOUT_MS);

    promise.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

main().catch((error) => {
  logger.error('Health check crashed', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});