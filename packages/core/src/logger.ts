import { styleText } from 'node:util';

export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

const ORDER: Record<LogLevel, number> = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

export interface Logger {
  level: LogLevel;
  error(message: string): void;
  warn(message: string): void;
  info(message: string): void;
  success(message: string): void;
  debug(message: string): void;
  step(message: string): void;
}

type Style = Parameters<typeof styleText>[0];

export interface LoggerOptions {
  level?: LogLevel;
  color?: boolean;
  /** Where log lines go. Defaults to stderr so stdout stays clean for `--json` output. */
  write?: (line: string) => void;
}

function colorEnabled(): boolean {
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.FORCE_COLOR !== undefined) return true;
  return Boolean(process.stderr.isTTY);
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const color = options.color ?? colorEnabled();
  const write = options.write ?? ((line: string) => process.stderr.write(`${line}\n`));
  const paint = (style: Style, text: string): string => (color ? styleText(style, text) : text);

  const logger: Logger = {
    level: options.level ?? 'info',
    error(message) {
      if (ORDER[logger.level] >= ORDER.error) write(`${paint('red', '✖')} ${message}`);
    },
    warn(message) {
      if (ORDER[logger.level] >= ORDER.warn) write(`${paint('yellow', '⚠')} ${message}`);
    },
    info(message) {
      if (ORDER[logger.level] >= ORDER.info) write(`${paint('cyan', 'ℹ')} ${message}`);
    },
    success(message) {
      if (ORDER[logger.level] >= ORDER.info) write(`${paint('green', '✔')} ${message}`);
    },
    step(message) {
      if (ORDER[logger.level] >= ORDER.info) write(`${paint('bold', '›')} ${message}`);
    },
    debug(message) {
      if (ORDER[logger.level] >= ORDER.debug) write(`${paint('gray', '·')} ${paint('gray', message)}`);
    },
  };
  return logger;
}

/** A logger that records lines in memory. Used by tests and by programmatic callers. */
export function createMemoryLogger(level: LogLevel = 'debug'): Logger & { lines: string[] } {
  const lines: string[] = [];
  const logger = createLogger({ level, color: false, write: (line) => lines.push(line) });
  return Object.assign(logger, { lines });
}
