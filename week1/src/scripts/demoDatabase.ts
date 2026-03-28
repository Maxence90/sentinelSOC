import { runDatabaseDemo } from '../storage/db/demo';

runDatabaseDemo().catch((error) => {
  console.error(error);
  process.exit(1);
});