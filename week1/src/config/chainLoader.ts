import * as fs from 'fs';
import * as path from 'path';
import {
  ChainConfig,
  ChainConfigFile,
  ChainRuntimeConfig,
  FastRulesConfig,
  ProtocolRegistryEntry,
  ResolvedChainRpcUrls,
  SupportedChainKey,
  SUPPORTED_CHAIN_KEYS,
} from './types';

const CONFIG_FILE_NAMES: Record<SupportedChainKey, string> = {
  ethereum: 'ethereum.json',
  og: 'og.json',
  monad: 'monad.json',
};

function isSupportedChainKey(value: string): value is SupportedChainKey {
  return SUPPORTED_CHAIN_KEYS.includes(value as SupportedChainKey);
}

export function getSelectedChainKey(rawChainKey: string | undefined = process.env.SELECTED_CHAIN): SupportedChainKey {
  if (!rawChainKey) {
    return 'ethereum';
  }

  const normalizedChainKey = rawChainKey.trim().toLowerCase();
  if (!isSupportedChainKey(normalizedChainKey)) {
    throw new Error(
      `Unsupported SELECTED_CHAIN: ${rawChainKey}. Supported chains: ${SUPPORTED_CHAIN_KEYS.join(', ')}`,
    );
  }

  return normalizedChainKey;
}

export function loadChainConfig(chainKey: SupportedChainKey = getSelectedChainKey()): ChainConfig {
  const configPath = resolveConfigPath(chainKey);
  const rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf8')) as ChainConfigFile;

  if (rawConfig.key !== chainKey) {
    throw new Error(`Chain config key mismatch in ${configPath}: expected ${chainKey}, received ${rawConfig.key}`);
  }

  const websocketResolution = resolveEnvValue(rawConfig.rpcEnv.websocket);
  const httpResolution = resolveEnvValue(rawConfig.rpcEnv.http);

  return {
    key: rawConfig.key,
    displayName: rawConfig.displayName,
    networkFamily: rawConfig.networkFamily,
    blockTimeMs: rawConfig.blockTimeMs,
    envPrefix: rawConfig.envPrefix,
    configPath,
    runtime: applyRuntimeOverrides(rawConfig.runtime, rawConfig.envPrefix),
    fastRules: normalizeFastRules(rawConfig.fastRules),
    protocolRegistry: normalizeProtocolRegistry(rawConfig.protocolRegistry),
    rpc: {
      websocketEnvNames: rawConfig.rpcEnv.websocket,
      websocketEnvName: websocketResolution.envName,
      websocketUrl: websocketResolution.value,
      httpEnvNames: rawConfig.rpcEnv.http,
      httpEnvName: httpResolution.envName,
      httpUrl: httpResolution.value,
    },
  };
}

export function resolveRequiredRpcUrls(chainConfig: ChainConfig): ResolvedChainRpcUrls {
  const missingRequirements: string[] = [];
  const websocketUrl = chainConfig.rpc.websocketUrl;
  const httpUrl = chainConfig.rpc.httpUrl;

  if (!websocketUrl) {
    missingRequirements.push(`websocket RPC (${chainConfig.rpc.websocketEnvNames.join(', ')})`);
  }

  if (!httpUrl) {
    missingRequirements.push(`http RPC (${chainConfig.rpc.httpEnvNames.join(', ')})`);
  }

  if (missingRequirements.length > 0) {
    throw new Error(`Missing ${chainConfig.displayName} RPC configuration: ${missingRequirements.join(' and ')}`);
  }

  if (!websocketUrl || !httpUrl) {
    throw new Error(`Missing ${chainConfig.displayName} RPC configuration after validation`);
  }

  return {
    websocketUrl,
    httpUrl,
  };
}

function resolveConfigPath(chainKey: SupportedChainKey): string {
  const fileName = CONFIG_FILE_NAMES[chainKey];
  const searchPaths = new Set<string>([
    path.resolve(process.cwd(), 'config', fileName),
    path.resolve(process.cwd(), 'week1', 'config', fileName),
    path.resolve(__dirname, '..', '..', 'config', fileName),
    path.resolve(__dirname, '..', '..', '..', 'config', fileName),
  ]);

  for (const searchPath of searchPaths) {
    if (fs.existsSync(searchPath)) {
      return searchPath;
    }
  }

  throw new Error(`Unable to locate chain config file for ${chainKey}: ${Array.from(searchPaths).join(', ')}`);
}

function resolveEnvValue(envNames: readonly string[]): { envName: string | null; value: string | null } {
  for (const envName of envNames) {
    const envValue = process.env[envName]?.trim();
    if (envValue) {
      return {
        envName,
        value: envValue,
      };
    }
  }

  return {
    envName: null,
    value: null,
  };
}

function applyRuntimeOverrides(runtime: ChainRuntimeConfig, envPrefix: string): ChainRuntimeConfig {
  return {
    analysisTimeoutMs: resolvePositiveIntegerEnv(`${envPrefix}_ANALYSIS_TIMEOUT_MS`) ?? runtime.analysisTimeoutMs,
    maxQueueSize: resolvePositiveIntegerEnv(`${envPrefix}_MAX_QUEUE_SIZE`) ?? runtime.maxQueueSize,
    workerCount: resolvePositiveIntegerEnv(`${envPrefix}_WORKER_COUNT`) ?? runtime.workerCount,
    riskThreshold: resolvePositiveIntegerEnv(`${envPrefix}_RISK_THRESHOLD`) ?? runtime.riskThreshold,
    startupRetryAttempts: resolvePositiveIntegerEnv(`${envPrefix}_STARTUP_RETRY_ATTEMPTS`) ?? runtime.startupRetryAttempts,
    startupRetryDelayMs: resolvePositiveIntegerEnv(`${envPrefix}_STARTUP_RETRY_DELAY_MS`) ?? runtime.startupRetryDelayMs,
    pendingRetryAttempts: resolvePositiveIntegerEnv(`${envPrefix}_PENDING_RETRY_ATTEMPTS`) ?? runtime.pendingRetryAttempts,
    pendingRetryDelayMs: resolvePositiveIntegerEnv(`${envPrefix}_PENDING_RETRY_DELAY_MS`) ?? runtime.pendingRetryDelayMs,
  };
}

function resolvePositiveIntegerEnv(envName: string): number | undefined {
  const rawValue = process.env[envName]?.trim();
  if (!rawValue) {
    return undefined;
  }

  const parsedValue = Number(rawValue);
  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`${envName} must be a positive integer, received: ${rawValue}`);
  }

  return parsedValue;
}

function normalizeFastRules(fastRules: FastRulesConfig): FastRulesConfig {
  return {
    highRiskMethodSignatures: uniqueValues(fastRules.highRiskMethodSignatures.map((signature) => signature.toLowerCase())),
    blacklistedAddresses: uniqueValues(fastRules.blacklistedAddresses.map((address) => address.toLowerCase())),
    knownAttackContracts: uniqueValues(fastRules.knownAttackContracts.map((address) => address.toLowerCase())),
    largeValueThresholdWei: fastRules.largeValueThresholdWei,
  };
}

function normalizeProtocolRegistry(protocolRegistry: readonly ProtocolRegistryEntry[]): ProtocolRegistryEntry[] {
  return protocolRegistry.map((entry) => ({
    address: entry.address.toLowerCase(),
    protocol: entry.protocol,
  }));
}

function uniqueValues(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}