export interface StoredTransaction {
  id: number;
  txHash: string;
  chainId: string;
  from: string;
  to: string | null;
  valueWei: string;
  protocol: string;
  methodName: string | null;
  methodSignature: string | null;
  callDataBytes: number;
  parsedParameters: Record<string, unknown> | null;
  riskScore: number;
  isRisky: boolean;
  riskReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoredLog {
  id: number;
  transactionId: number;
  action: string;
  details: string;
  metadata: Record<string, unknown> | null;
  processedAt: string;
}

export interface RiskHit {
  id: number;
  transactionId: number;
  dedupeKey: string;
  ruleName: string;
  scoreDelta: number;
  reason: string;
  evidence: Record<string, unknown> | null;
  createdAt: string;
}

export interface SaveTransactionInput {
  txHash: string;
  chainId: string;
  from: string;
  to: string | null;
  valueWei: string;
  protocol: string;
  methodName: string | null;
  methodSignature: string | null;
  callDataBytes: number;
  parsedParameters: Record<string, unknown> | null;
  riskScore: number;
  isRisky: boolean;
  riskReason: string | null;
}

export interface RiskHitInput {
  dedupeKey?: string;
  ruleName: string;
  scoreDelta: number;
  reason: string;
  evidence?: Record<string, unknown>;
}

export interface TransactionLogInput {
  action: string;
  details: string;
  metadata?: Record<string, unknown>;
}

export interface SaveAnalysisResultInput {
  transaction: SaveTransactionInput;
  riskHits: RiskHitInput[];
  log: TransactionLogInput;
}

export interface AnalysisPersistenceResult {
  transaction: StoredTransaction;
  riskHits: RiskHit[];
  log: StoredLog;
}