import { runMempoolListener } from '../listeners/mempoolListener';

runMempoolListener().catch((error) => {
  console.error(error);
  process.exit(1);
});