import { redact } from '../security/redact.js';

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug';

const LEVEL_ORDER: Record<LogLevel, number> = {
  fatal: 60,
  error: 50,
  warn: 40,
  info: 30,
  debug: 20,
};

/**
 * Minimal structured logger. Every field passes through redact() before
 * serialization so sensitive values never reach output.
 */
export class Logger {
  constructor(private level: LogLevel) {}

  private enabled(l: LogLevel): boolean {
    return LEVEL_ORDER[l] >= LEVEL_ORDER[this.level];
  }

  private write(l: LogLevel, msg: string, fields?: Record<string, unknown>): void {
    if (!this.enabled(l)) return;
    const safeFields = redact(fields ?? {}) as Record<string, unknown>;
    const entry = { time: new Date().toISOString(), level: l, msg, ...safeFields };
    const line = JSON.stringify(entry);
    if (l === 'error' || l === 'fatal') process.stderr.write(line + '\n');
    else process.stdout.write(line + '\n');
  }

  fatal = (msg: string, f?: Record<string, unknown>) => this.write('fatal', msg, f);
  error = (msg: string, f?: Record<string, unknown>) => this.write('error', msg, f);
  warn = (msg: string, f?: Record<string, unknown>) => this.write('warn', msg, f);
  info = (msg: string, f?: Record<string, unknown>) => this.write('info', msg, f);
  debug = (msg: string, f?: Record<string, unknown>) => this.write('debug', msg, f);
}

export function createLogger(level: LogLevel): Logger {
  return new Logger(level);
}
