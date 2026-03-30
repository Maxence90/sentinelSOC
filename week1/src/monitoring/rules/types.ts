import { ParsedTransaction } from '../../parsers/transactionParser';
import { RiskHitInput } from '../../storage/db/types';

export const DEFAULT_RISK_THRESHOLD = 30;

export interface RiskRuleDefinition {
  ruleName: string;
  scoreDelta: number;
  matches: (parsed: ParsedTransaction) => boolean;
  getDedupeKey?: (parsed: ParsedTransaction) => string;
  getReason: (parsed: ParsedTransaction) => string;
  getEvidence?: (parsed: ParsedTransaction) => Record<string, unknown> | undefined;
}

export interface RiskEvaluationResult {
  riskHits: RiskHitInput[];
  riskScore: number;
  isRisky: boolean;
  riskReason: string | null;
}

export interface RiskScorer {
  evaluate(parsed: ParsedTransaction): RiskEvaluationResult;
}