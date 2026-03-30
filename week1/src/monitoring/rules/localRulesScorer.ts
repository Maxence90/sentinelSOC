import { ParsedTransaction } from '../../parsers/transactionParser';
import { RiskHitInput } from '../../storage/db/types';
import { DEFAULT_RISK_RULES } from './defaultRules';
import { DEFAULT_RISK_THRESHOLD, RiskEvaluationResult, RiskRuleDefinition, RiskScorer } from './types';

function buildRiskReason(parsed: ParsedTransaction): string | null {
  const reasons: string[] = [];

  if (parsed.methodName?.includes('approve')) {
    reasons.push('ERC20 approval detected');
  }
  if (parsed.methodName?.includes('transferFrom')) {
    reasons.push('Delegated token transfer detected');
  }
  if (parsed.methodName?.includes('permit')) {
    reasons.push('Off-chain approval signature detected');
  }
  if (parsed.methodName?.includes('swap')) {
    reasons.push('Token swap detected');
  }
  if (parsed.methodName?.includes('flashLoan')) {
    reasons.push('Flash loan operation detected');
  }
  if (parsed.protocol === '1inch Router') {
    reasons.push('Multi-protocol aggregator');
  }
  if (parseFloat(parsed.valueEth) > 10) {
    reasons.push('Large ETH value transfer');
  }

  return reasons.length > 0 ? reasons.join('; ') : null;
}

function buildRiskHit(parsed: ParsedTransaction, rule: RiskRuleDefinition): RiskHitInput {
  return {
    dedupeKey: rule.getDedupeKey ? rule.getDedupeKey(parsed) : rule.ruleName,
    ruleName: rule.ruleName,
    scoreDelta: rule.scoreDelta,
    reason: rule.getReason(parsed),
    evidence: rule.getEvidence ? rule.getEvidence(parsed) : undefined,
  };
}

export class LocalRulesScorer implements RiskScorer {
  constructor(
    private readonly rules: ReadonlyArray<RiskRuleDefinition> = DEFAULT_RISK_RULES,
    private readonly riskThreshold: number = DEFAULT_RISK_THRESHOLD,
  ) {}

  evaluate(parsed: ParsedTransaction): RiskEvaluationResult {
    const riskHits = this.rules.filter((rule) => rule.matches(parsed)).map((rule) => buildRiskHit(parsed, rule));
    const riskScore = Math.min(riskHits.reduce((total, hit) => total + hit.scoreDelta, 0), 100);

    return {
      riskHits,
      riskScore,
      isRisky: riskScore >= this.riskThreshold,
      riskReason: buildRiskReason(parsed),
    };
  }
}