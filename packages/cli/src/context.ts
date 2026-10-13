import path from 'node:path';
import {
  createLogger,
  loadConfig,
  resolveProject,
  staticAdapter,
  type FrameworkAdapter,
  type LoadedConfig,
  type Logger,
  type LogLevel,
  type ProjectContext,
} from '@dont-copy-me/core';
import { viteAdapter } from '@dont-copy-me/framework-vite';

export const ADAPTERS: readonly FrameworkAdapter[] = [viteAdapter, staticAdapter];

export interface GlobalOptions {
  cwd?: string;
  config?: string;
  json?: boolean;
  logLevel?: LogLevel;
  quiet?: boolean;
  color?: boolean;
}

export interface CommandContext {
  options: GlobalOptions;
  logger: Logger;
  loaded: LoadedConfig;
  project: ProjectContext;
  /** Writes machine-readable output to stdout when --json is set. */
  emit(data: unknown): void;
}

export function makeLogger(options: GlobalOptions, fallback: LogLevel = 'info'): Logger {
  const level: LogLevel = options.quiet ? 'error' : (options.logLevel ?? fallback);
  return createLogger({ level, ...(options.color === false ? { color: false } : {}) });
}

export async function createContext(options: GlobalOptions): Promise<CommandContext> {
  const root = path.resolve(options.cwd ?? process.cwd());
  const loaded = await loadConfig(root, options.config);
  const logger = makeLogger(options, loaded.config.logLevel);
  const project = await resolveProject(root, loaded.config, ADAPTERS);
  return {
    options,
    logger,
    loaded,
    project,
    emit(data) {
      if (options.json) process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    },
  };
}

export function rel(project: ProjectContext, p: string): string {
  return path.relative(project.root, p) || '.';
}
