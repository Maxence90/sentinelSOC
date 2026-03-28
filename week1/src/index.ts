import 'dotenv/config';
import { Logger } from './utils/logger';

const logger = new Logger('SentinelSOC');

async function main(): Promise<void> {
  logger.info('🚀 SentinelSOC Project Started');
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info('Available commands:');
  logger.info('  - npm run mempool:listen    : Listen to pending transactions');
  logger.info('  - npm run tx:parse          : Parse transaction call data');
  logger.info('  - npm run db:init           : Initialize PostgreSQL schema');
  logger.info('  - npm run db:demo           : Insert a sample analysis transaction');
  logger.info('  - npm run integrated        : Run complete monitoring system');
  logger.info('');
  logger.info('To start development:');
  logger.info('  1. Create .env file from .env.example');
  logger.info('  2. Add your Infura or Alchemy API key and PostgreSQL DATABASE_URL');
  logger.info('  3. Run: npm run db:init');
  logger.info('  4. Optional: run npm run db:demo');
  logger.info('  5. Run: npm run mempool:listen');
}

main().catch(logger.error);
