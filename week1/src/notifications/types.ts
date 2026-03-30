import { RiskHitInput } from '../storage/db/types';

export interface RiskAlertPayload {
  txHash: string;
  chainId: string;
  protocol: string;
  methodName: string | null;
  from: string;
  to: string | null;
  valueEth: string;
  valueWei: string;
  riskScore: number;
  riskReason: string | null;
  riskHits: RiskHitInput[];
  detectedAt: string;
}

export interface RiskNotifier {
  notifyRiskEvent(payload: RiskAlertPayload): Promise<void>;
}