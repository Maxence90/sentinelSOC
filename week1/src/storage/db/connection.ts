import 'dotenv/config';
import { Pool } from 'pg';

let pool: Pool | null = null;

function getDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required. Example: postgres://postgres:postgres@localhost:5432/sentinelsoc');
  }

  return databaseUrl;
}

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: getDatabaseUrl() });
  }

  return pool;
}

export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}