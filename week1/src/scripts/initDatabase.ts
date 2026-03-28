import { Logger } from '../utils/logger';
import { closeDatabase } from '../storage/db/connection';
import { initializeDatabase } from '../storage/db/schema';

const logger = new Logger('DatabaseInit');

async function main(): Promise<void> {
  try {
    await initializeDatabase();
    logger.info('✅ Database schema is ready');
  } catch (error) {
    logger.error('Database init failed', error);
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
}

main().catch((error) => {
  logger.error('Fatal database init error', error);
  process.exit(1);
});