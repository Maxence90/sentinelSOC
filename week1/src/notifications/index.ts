import { Logger } from '../utils/logger';
import { FeishuNotifier } from './feishuNotifier';
import { RiskAlertPayload, RiskNotifier } from './types';

const logger = new Logger('Notifications');

class NoopRiskNotifier implements RiskNotifier {
  async notifyRiskEvent(_payload: RiskAlertPayload): Promise<void> {
    return Promise.resolve();
  }
}

function parseMinAlertScore(rawValue: string | undefined): number {
  if (!rawValue) {
    return 30;
  }

  const parsedValue = Number(rawValue);
  return Number.isFinite(parsedValue) ? parsedValue : 30;
}

export function createRiskNotifier(): RiskNotifier {
  const webhookUrl = process.env.FEISHU_WEBHOOK_URL;

  if (!webhookUrl) {
    logger.info('Feishu notifier disabled because FEISHU_WEBHOOK_URL is not configured');
    return new NoopRiskNotifier();
  }

  const minAlertScore = parseMinAlertScore(process.env.FEISHU_ALERT_MIN_SCORE);
  logger.info('Feishu notifier enabled', { minAlertScore });
  return new FeishuNotifier(webhookUrl, minAlertScore);
}

export type { RiskAlertPayload, RiskNotifier } from './types';