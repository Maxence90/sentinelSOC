//以太坊内存池监听器
//早期原型，用于快速验证监听功能是否正常
import 'dotenv/config';
import { ethers } from 'ethers';
import { Logger } from '../utils/logger';

const logger = new Logger('MempoolListener');
interface TransactionDetails {
  hash: string;
  from: string;
  to: string | null;
  value: string;
  data: string;
  gasPrice: string;
  gasLimit: string;
  nonce: number;
}

export class MempoolListener {
  private provider: ethers.WebSocketProvider;
  private transactionCount: number = 0;

  constructor(wsUrl: string) {
    this.provider = new ethers.WebSocketProvider(wsUrl);
  }

  async connect(): Promise<void> {
    try {
      const network = await this.provider.getNetwork();
      logger.info(`✅ Connected to network: ${network.name} (chainId: ${network.chainId})`);
    } catch (error) {
      logger.error('Failed to connect to provider', error);
      throw error;
    }
  }

  private formatTransaction(tx: ethers.TransactionResponse): TransactionDetails {
    return {
      hash: tx.hash,
      from: tx.from || 'unknown',
      to: tx.to || 'contract creation',
      value: `${ethers.formatEther(tx.value)} ETH`,
      data: tx.data.substring(0, 100) + (tx.data.length > 100 ? '...' : ''),
      gasPrice: `${ethers.formatUnits(tx.gasPrice || 0, 'gwei')} gwei`,
      gasLimit: tx.gasLimit.toString(),
      nonce: tx.nonce,
    };
  }

  private isRiskyTransaction(data: string): boolean {
    return data.startsWith('0x095ea7b3') || data.startsWith('0x23b872dd') || data.startsWith('0xd505accf');
  }

  async startListening(): Promise<void> {
    logger.info('👂 Listening for pending transactions...\n');

    this.provider.on('pending', async (txHash: string) => {
      try {
        this.transactionCount++;

        const tx = await this.provider.getTransaction(txHash);
        if (!tx) {
          logger.debug('Transaction not found', { txHash });
          return;
        }

        const formatted = this.formatTransaction(tx);
        const isRisky = this.isRiskyTransaction(tx.data);
        const riskLabel = isRisky ? '⚠️  [RISKY]' : '✅';

        logger.info(`\n${riskLabel} Transaction #${this.transactionCount}`, {
          hash: formatted.hash,
          from: formatted.from,
          to: formatted.to,
          value: formatted.value,
          dataSize: tx.data.length,
          gasPrice: formatted.gasPrice,
          gasLimit: formatted.gasLimit,
          nonce: formatted.nonce,
        });

        if (tx.data.length > 2) {
          logger.info(`   📋 Call data: ${formatted.data}`);
        }
      } catch (error) {
        logger.warn('Error processing transaction', { txHash, error: String(error) });
      }
    });

    process.on('SIGINT', () => {
      logger.info(`\n👋 Listener stopped. Total transactions seen: ${this.transactionCount}`);
      this.provider.removeAllListeners();
      process.exit(0);
    });

    this.provider.on('network', (newNetwork, oldNetwork) => {
      if (oldNetwork) {
        logger.warn('Network changed', { from: oldNetwork.chainId, to: newNetwork.chainId });
      }
    });

    this.provider.on('error', (error) => {
      logger.error('Provider error', error);
    });
  }
}

export async function runMempoolListener(): Promise<void> {
  const wsUrl = process.env.INFURA_WS_URL || process.env.ALCHEMY_WS_URL;

  if (!wsUrl) {
    logger.error('❌ WebSocket URL not configured');
    logger.info('Please set INFURA_WS_URL or ALCHEMY_WS_URL in .env file');
    process.exit(1);
  }

  const listener = new MempoolListener(wsUrl);

  await listener.connect();
  await listener.startListening();
}