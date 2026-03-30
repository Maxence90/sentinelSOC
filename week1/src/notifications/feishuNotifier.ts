import axios from 'axios';
import { Logger } from '../utils/logger';
import { RiskAlertPayload, RiskNotifier } from './types';

const logger = new Logger('FeishuNotifier');

function formatAlertText(payload: RiskAlertPayload): string {
  const topHits = payload.riskHits.slice(0, 3).map((hit) => `${hit.ruleName}(+${hit.scoreDelta})`).join(', ');

  return [
    'SentinelSOC 风险告警',
    `风险分: ${payload.riskScore}`,
    `协议: ${payload.protocol}`,
    `方法: ${payload.methodName || 'unknown'}`,
    `交易哈希: ${payload.txHash}`,
    `发送方: ${payload.from}`,
    `接收方: ${payload.to || 'contract creation'}`,
    `金额(ETH): ${payload.valueEth}`,
    `风险摘要: ${payload.riskReason || '无'}`,
    `命中规则: ${topHits || '无'}`,
    `检测时间: ${payload.detectedAt}`,
  ].join('\n');
}

export class FeishuNotifier implements RiskNotifier {
  constructor(
    private readonly webhookUrl: string,
    private readonly minAlertScore: number,
  ) {}

  async notifyRiskEvent(payload: RiskAlertPayload): Promise<void> {
    if (payload.riskScore < this.minAlertScore) {
      return;
    }

    await axios.post(
      this.webhookUrl,
      {
        msg_type: 'text',
        content: {
          text: formatAlertText(payload),
        },
      },
      {
        timeout: 5000,
      }
    );

    logger.info('Feishu alert sent', {
      txHash: payload.txHash,
      riskScore: payload.riskScore,
    });
  }
}