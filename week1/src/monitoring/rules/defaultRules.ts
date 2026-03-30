import { ParsedTransaction } from '../../parsers/transactionParser';
import { RiskRuleDefinition } from './types';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

function hasRiskyMethodKeyword(parsed: ParsedTransaction): boolean {
  const riskyMethods = ['approve', 'transferFrom', 'permit', 'swap', 'flashLoan'];
  return Boolean(parsed.methodName && riskyMethods.some((method) => parsed.methodName?.includes(method)));
}

export const DEFAULT_RISK_RULES: ReadonlyArray<RiskRuleDefinition> = [
  {
    ruleName: 'high_risk_protocol',
    scoreDelta: 20,
    matches: (parsed) => ['1inch Router', 'Unknown'].includes(parsed.protocol),
    getDedupeKey: () => 'high_risk_protocol',
    getReason: (parsed) => `Protocol ${parsed.protocol} is treated as high risk in the MVP rules`,
    getEvidence: (parsed) => ({ protocol: parsed.protocol }),
  },
  {
    ruleName: 'risky_method_detected',
    scoreDelta: 15,
    matches: hasRiskyMethodKeyword,
    getDedupeKey: (parsed) => `risky_method_detected:${parsed.methodName || 'unknown'}`,
    getReason: (parsed) => `Method ${parsed.methodName} matched risky method keywords`,
    getEvidence: (parsed) => ({ methodName: parsed.methodName }),
  },
  {
    ruleName: 'large_value_transfer',
    scoreDelta: 10,
    matches: (parsed) => parseFloat(parsed.valueEth) > 10,
    getDedupeKey: () => 'large_value_transfer',
    getReason: () => 'Transaction value exceeded the 10 ETH MVP threshold',
    getEvidence: (parsed) => ({ valueEth: parsed.valueEth, valueWei: parsed.valueWei }),
  },
  {
    ruleName: 'contract_creation_detected',
    scoreDelta: 25,
    matches: (parsed) => parsed.to === ZERO_ADDRESS,
    getDedupeKey: () => 'contract_creation_detected',
    getReason: () => 'Contract creation is treated as higher risk in the MVP ruleset',
    getEvidence: (parsed) => ({ to: parsed.to }),
  },
];