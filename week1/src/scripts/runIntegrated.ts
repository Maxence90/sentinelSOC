import { runIntegratedMonitor } from '../monitoring/integratedMonitor';

runIntegratedMonitor().catch((error) => {
  console.error(error);
  process.exit(1);
});