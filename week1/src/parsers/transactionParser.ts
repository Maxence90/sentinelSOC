//解析脚本，负责将原始交易数据转换成结构化的格式，提取协议、方法、参数等信息，为后续的分析和存储提供基础数据。
import 'dotenv/config';
import { ethers } from 'ethers';
import { ABIS } from '../utils/abis';
import { Logger } from '../utils/logger';

const logger = new Logger('TransactionParser');

export interface ParsedTransaction {
  txHash: string;
  from: string;
  to: string;
  valueEth: string;
  valueWei: string;
  chainId: string;
  protocol: string;
  methodName: string | null;
  methodSignature: string | null;
  callDataBytes: number;
  parameters: Record<string, unknown> | null;
}

export class TransactionParser {
  private provider: ethers.Provider;
  private interfaces: Record<string, ethers.Interface>;
  private networkPromise: Promise<ethers.Network> | null;
  private readonly maxConcurrentRequests: number;

  constructor(providerUrl: string) {
    this.provider = new ethers.JsonRpcProvider(providerUrl);
    this.networkPromise = null;
    this.maxConcurrentRequests = 2;
    this.interfaces = {
      uniswap: new ethers.Interface(ABIS.UNISWAP_ROUTER),
      aave: new ethers.Interface(ABIS.AAVE_POOL),
      erc20: new ethers.Interface(ABIS.ERC20),
      weth: new ethers.Interface(ABIS.WETH),
      curve: new ethers.Interface(ABIS.CURVE_POOL),
    };
  }

  private getMethodSignature(data: string): string {
    if (data.length < 10) {
      return 'unknown';
    }

    return data.substring(0, 10);
  }

  private detectProtocol(to: string): string {
    const lowerTo = to.toLowerCase();

    if (['0xe592427a0aece92de3edee1f18e0157c05861564', '0x68b3465833fb72b5a828ccedac0e142e3e659da7'].includes(lowerTo)) {
      return 'Uniswap V3';
    }
    if (lowerTo === '0x7a250d5630b4cf539739df2c5dacb4c659f2488d') {
      return 'Uniswap V2';
    }
    if (lowerTo === '0x7d2768de32b0b80b7a3454c06bdac94a69ddc7a9') {
      return 'Aave V2';
    }
    if (lowerTo === '0x794a61358d6845594f94dc1db02a252b5b4814ad') {
      return 'Aave V3';
    }
    if (lowerTo.startsWith('0xdc')) {
      return 'Curve Finance';
    }

    return 'Unknown';
  }

  private parseCalldata(to: string, data: string): { method: string | null; params: Record<string, unknown> | null } {
    const protocol = this.detectProtocol(to);
    let iface: ethers.Interface | null = null;

    if (protocol.includes('Uniswap')) {
      iface = this.interfaces.uniswap;
    } else if (protocol.includes('Aave')) {
      iface = this.interfaces.aave;
    } else if (data.startsWith('0x095ea7b3') || data.startsWith('0x23b872dd')) {
      iface = this.interfaces.erc20;
    }

    if (!iface) {
      return {
        method: this.getMethodSignature(data),
        params: null,
      };
    }

    try {
      const parsed = iface.parseTransaction({ data });
      if (!parsed) {
        return {
          method: this.getMethodSignature(data),
          params: null,
        };
      }

      const params: Record<string, unknown> = {};
      if (parsed.args) {
        parsed.args.forEach((arg, index) => {
          const paramName = parsed.fragment.inputs?.[index]?.name || `param${index}`;
          params[paramName] = typeof arg === 'bigint' ? arg.toString() : arg;
        });
      }

      return {
        method: `${parsed.name}(${parsed.fragment.inputs?.map((input) => input.type).join(',')})`,
        params: Object.keys(params).length > 0 ? params : null,
      };
    } catch (error) {
      logger.debug('Failed to parse with interface', { error: String(error) });
      return {
        method: this.getMethodSignature(data),
        params: null,
      };
    }
  }

  private async getChainId(): Promise<string> {
    if (!this.networkPromise) {
      this.networkPromise = this.provider.getNetwork();
    }

    const network = await this.networkPromise;
    return network.chainId.toString();
  }

  private buildParsedTransaction(tx: ethers.TransactionResponse, chainId: string): ParsedTransaction {
    const to = tx.to || '0x0000000000000000000000000000000000000000';
    const protocol = this.detectProtocol(tx.to || '');
    const { method, params } = this.parseCalldata(tx.to || '0x', tx.data);
    const callDataBytes = tx.data.length > 2 ? (tx.data.length - 2) / 2 : 0;

    return {
      txHash: tx.hash,
      from: tx.from || 'unknown',
      to,
      valueEth: ethers.formatEther(tx.value),
      valueWei: tx.value.toString(),
      chainId,
      protocol,
      methodName: method,
      methodSignature: this.getMethodSignature(tx.data),
      callDataBytes,
      parameters: params,
    };
  }

  async parseTransaction(txHash: string): Promise<ParsedTransaction | null> {
    try {
      const tx = await this.provider.getTransaction(txHash);
      if (!tx) {
        logger.warn(`Transaction not found: ${txHash}`);
        return null;
      }

      const chainId = await this.getChainId();
      return this.buildParsedTransaction(tx, chainId);
    } catch (error) {
      logger.error('Error parsing transaction', { txHash, error: String(error) });
      return null;
    }
  }

  async parseMultipleTransactionsParallel(txHashes: readonly string[]): Promise<ParsedTransaction[]> {
    const results: ParsedTransaction[] = [];

    for (let index = 0; index < txHashes.length; index += this.maxConcurrentRequests) {
      const batch = txHashes.slice(index, index + this.maxConcurrentRequests);
      const batchResults = await Promise.all(batch.map((txHash) => this.parseTransaction(txHash)));
      results.push(...batchResults.filter((tx): tx is ParsedTransaction => tx !== null));
    }

    return results;
  }

  async parseRecentBlock(blockTag: 'latest' | number = 'latest', limit?: number): Promise<ParsedTransaction[]> {
    try {
      const chainId = await this.getChainId();
      const block = await this.provider.getBlock(blockTag, true);

      if (!block) {
        logger.warn(`Block not found: ${blockTag}`);
        return [];
      }

      const prefetchedTransactions = block.prefetchedTransactions;
      if (prefetchedTransactions.length > 0 || block.transactions.length === 0) {
        const transactions = limit ? prefetchedTransactions.slice(0, limit) : prefetchedTransactions;
        return transactions.map((tx) => this.buildParsedTransaction(tx, chainId));
      }
    } catch (error) {
      logger.debug('Falling back to hash-based block parsing', { blockTag: String(blockTag), error: String(error) });
    }

    const block = await this.provider.getBlock(blockTag);
    if (!block) {
      logger.warn(`Block not found: ${blockTag}`);
      return [];
    }

    const txHashes = limit ? block.transactions.slice(0, limit) : block.transactions;
    return this.parseMultipleTransactionsParallel(txHashes);
  }
}

export async function runTransactionParserDemo(): Promise<void> {
  const httpUrl = process.env.INFURA_HTTP_URL;

  if (!httpUrl) {
    logger.error('❌ INFURA_HTTP_URL not configured');
    process.exit(1);
  }

  const parser = new TransactionParser(httpUrl);
  logger.info('🔍 Transaction Parser Demo\n');

  try {
    logger.info('=== Example 1: Parse Recent Block Transactions ===\n');
    const blockTxs = await parser.parseRecentBlock('latest', 10);

    blockTxs.forEach((tx, index) => {
      logger.info(`\nTransaction ${index + 1}:`, {
        hash: `${tx.txHash.substring(0, 16)}...`,
        protocol: tx.protocol,
        method: tx.methodName,
        from: `${tx.from.substring(0, 10)}...`,
        to: `${tx.to.substring(0, 10)}...`,
        callDataBytes: tx.callDataBytes,
      });

      if (tx.parameters) {
        logger.info('   Parameters:', tx.parameters);
      }
    });

    logger.info(`\n✅ Successfully parsed ${blockTxs.length} transactions`);
    logger.info('\n=== Example 2: Parse Multiple Transactions ===\n');

    if (blockTxs.length >= 2) {
      const sampleHashes = blockTxs.slice(0, 2).map((tx) => tx.txHash);
      const batchResults = await parser.parseMultipleTransactionsParallel(sampleHashes);
      logger.info(`✅ Batch parsed ${batchResults.length} transactions`);
    } else {
      logger.info('Not enough transactions for batch demo');
    }
  } catch (error) {
    logger.error('Demo error', error);
    throw error;
  }
}