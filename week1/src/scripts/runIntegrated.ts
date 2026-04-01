import { loadChainConfig, resolveRequiredRpcUrls } from '../config';
import { runIntegratedMonitor } from '../monitoring/integratedMonitor';
import { LocalRulesScorer } from '../monitoring/rules';
import { Logger } from '../utils/logger';

const logger = new Logger('RunIntegrated');

const chainConfig = loadChainConfig();
const rpcUrls = resolveRequiredRpcUrls(chainConfig);

logger.info('Using chain configuration', {
  chain: chainConfig.key,
  displayName: chainConfig.displayName,
  configPath: chainConfig.configPath,
  runtime: chainConfig.runtime,
  websocketEnvName: chainConfig.rpc.websocketEnvName,
  httpEnvName: chainConfig.rpc.httpEnvName,
});

runIntegratedMonitor({
  wsUrl: rpcUrls.websocketUrl,
  httpUrl: rpcUrls.httpUrl,
  scorer: new LocalRulesScorer(undefined, chainConfig.runtime.riskThreshold),
}).catch((error) => {
  console.error(error);
  process.exit(1);
});