export const SUPPORTED_CHAIN_KEYS = ['ethereum', 'og', 'monad'] as const;

export type SupportedChainKey = typeof SUPPORTED_CHAIN_KEYS[number];

export interface RpcEnvConfig {
  websocket: string[];
  http: string[];
}

export interface ChainRuntimeConfig {
  analysisTimeoutMs: number;
  maxQueueSize: number;
  workerCount: number;
  riskThreshold: number;
  startupRetryAttempts: number;
  startupRetryDelayMs: number;
  pendingRetryAttempts: number;
  pendingRetryDelayMs: number;
}

export interface FastRulesConfig {
  highRiskMethodSignatures: string[];
  blacklistedAddresses: string[];
  knownAttackContracts: string[];
  largeValueThresholdWei: string;
}

export interface ProtocolRegistryEntry {
  address: string;
  protocol: string;
}

export interface ChainConfigFile {
  key: SupportedChainKey;
  displayName: string;
  networkFamily: string;
  blockTimeMs: number;
  envPrefix: string;
  rpcEnv: RpcEnvConfig;
  runtime: ChainRuntimeConfig;
  fastRules: FastRulesConfig;
  protocolRegistry: ProtocolRegistryEntry[];
}

export interface ResolvedRpcConfig {
  websocketEnvNames: string[];
  websocketEnvName: string | null;
  websocketUrl: string | null;
  httpEnvNames: string[];
  httpEnvName: string | null;
  httpUrl: string | null;
}

export interface ChainConfig {
  key: SupportedChainKey;
  displayName: string;
  networkFamily: string;
  blockTimeMs: number;
  envPrefix: string;
  configPath: string;
  runtime: ChainRuntimeConfig;
  fastRules: FastRulesConfig;
  protocolRegistry: ProtocolRegistryEntry[];
  rpc: ResolvedRpcConfig;
}

export interface ResolvedChainRpcUrls {
  websocketUrl: string;
  httpUrl: string;
}