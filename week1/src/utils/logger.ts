/**
 * Utility: Logger
 * Day 1: 简单日志工具
 */

export class Logger {
  private context: string;

  constructor(context: string = 'App') {
    this.context = context;
  }

  private formatTime(): string {
    return new Date().toISOString();
  }

  private format(level: string, message: string, data?: unknown): string {
    const time = this.formatTime();
    const dataStr = data ? ` ${JSON.stringify(data)}` : '';
    return `[${time}] [${this.context}] [${level}]${dataStr} ${message}`;
  }

  info(message: string, data?: unknown): void {
    console.log(this.format('INFO', message, data));
  }

  debug(message: string, data?: unknown): void {
    if (process.env.LOG_LEVEL === 'debug') {
      console.log(this.format('DEBUG', message, data));
    }
  }

  warn(message: string, data?: unknown): void {
    console.warn(this.format('WARN', message, data));
  }

  error(message: string, data?: unknown): void {
    console.error(this.format('ERROR', message, data));
  }
}
