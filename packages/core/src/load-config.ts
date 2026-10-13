import fs from 'node:fs/promises';
import path from 'node:path';
import { createJiti } from 'jiti';
import { parseConfig, type DcmConfig } from './config.js';
import { DcmError, ExitCode } from './errors.js';
import { pathExists } from './fs-atomic.js';

export const CONFIG_FILES = ['dcm.config.ts', 'dcm.config.mts', 'dcm.config.mjs', 'dcm.config.js', 'dcm.config.json'] as const;

export interface LoadedConfig {
  config: DcmConfig;
  /** Absolute path of the configuration file, or undefined when defaults are used. */
  file: string | undefined;
  projectRoot: string;
}

export async function findConfigFile(projectRoot: string): Promise<string | undefined> {
  for (const name of CONFIG_FILES) {
    const candidate = path.join(projectRoot, name);
    if (await pathExists(candidate)) return candidate;
  }
  return undefined;
}

async function importConfig(file: string): Promise<unknown> {
  if (file.endsWith('.json')) {
    return JSON.parse(await fs.readFile(file, 'utf8')) as unknown;
  }
  const jiti = createJiti(import.meta.url, { moduleCache: false, fsCache: false });
  return jiti.import(file, { default: true });
}

/**
 * Loads and validates the project configuration. Missing configuration yields defaults so
 * read-only commands such as `scan` work before `init`.
 */
export async function loadConfig(projectRoot: string, explicitFile?: string): Promise<LoadedConfig> {
  const root = path.resolve(projectRoot);
  const file = explicitFile ? path.resolve(root, explicitFile) : await findConfigFile(root);
  if (explicitFile && !(file && (await pathExists(file)))) {
    throw new DcmError('E_CONFIG_MISSING', `Config file not found: ${explicitFile}`, { exitCode: ExitCode.Config });
  }
  let raw: unknown = {};
  if (file) {
    try {
      raw = await importConfig(file);
    } catch (error) {
      throw new DcmError('E_CONFIG_LOAD', `Could not load ${path.basename(file)}: ${(error as Error).message}`, {
        hint: 'Check the file for syntax errors. `import { defineConfig } from "dont-copy-me"` requires the package to be installed.',
        exitCode: ExitCode.Config,
        cause: error,
      });
    }
  }
  const parsed = parseConfig(raw);
  if (!parsed.ok) {
    const details = parsed.issues.map((i) => `  • ${i.path}: ${i.message}`).join('\n');
    throw new DcmError('E_CONFIG_INVALID', `Invalid configuration${file ? ` in ${path.basename(file)}` : ''}:\n${details}`, {
      exitCode: ExitCode.Config,
    });
  }
  return { config: parsed.config, file, projectRoot: root };
}
