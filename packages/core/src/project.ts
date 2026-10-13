import fs from 'node:fs/promises';
import path from 'node:path';
import type { FrameworkAdapter } from './adapter.js';
import type { DcmConfig } from './config.js';
import { DcmError, ExitCode } from './errors.js';
import { pathExists } from './fs-atomic.js';
import { assertSafeOutput, resolveInside } from './paths.js';

export interface ProjectContext {
  root: string;
  config: DcmConfig;
  adapter: FrameworkAdapter;
  detection: { auto: boolean; confidence: number; evidence: string[] };
  inputDir: string;
  outputDir: string;
  dcmDir: string;
  reportsDir: string;
  backupsDir: string;
}

export async function detectFramework(
  root: string,
  adapters: readonly FrameworkAdapter[],
): Promise<{ adapter: FrameworkAdapter; confidence: number; evidence: string[] } | undefined> {
  let best: { adapter: FrameworkAdapter; confidence: number; evidence: string[] } | undefined;
  for (const adapter of adapters) {
    const result = await adapter.detect(root);
    if (result && (!best || result.confidence > best.confidence)) {
      best = { adapter, confidence: result.confidence, evidence: result.evidence };
    }
  }
  return best;
}

export async function resolveProject(
  root: string,
  config: DcmConfig,
  adapters: readonly FrameworkAdapter[],
): Promise<ProjectContext> {
  const absRoot = path.resolve(root);
  let adapter: FrameworkAdapter | undefined;
  let detection: ProjectContext['detection'];
  if (config.framework === 'auto') {
    const found = await detectFramework(absRoot, adapters);
    adapter = found?.adapter ?? adapters.find((a) => a.name === 'static');
    detection = { auto: true, confidence: found?.confidence ?? 0, evidence: found?.evidence ?? ['no framework detected'] };
  } else {
    adapter = adapters.find((a) => a.name === config.framework);
    detection = { auto: false, confidence: 1, evidence: [`framework set to "${config.framework}" in config`] };
  }
  if (!adapter) {
    throw new DcmError('E_ADAPTER', `No adapter available for framework "${config.framework}"`, { exitCode: ExitCode.Config });
  }
  const inputDir = resolveInside(absRoot, config.input ?? adapter.defaultInput, 'input');
  const outputDir = resolveInside(absRoot, config.output ?? adapter.defaultOutput, 'output');
  assertSafeOutput(absRoot, inputDir, outputDir);
  const dcmDir = path.join(absRoot, '.dcm');
  return {
    root: absRoot,
    config,
    adapter,
    detection,
    inputDir,
    outputDir,
    dcmDir,
    reportsDir: resolveInside(absRoot, config.report.dir, 'report.dir'),
    backupsDir: path.join(dcmDir, 'backups'),
  };
}

export type ReportName = 'protect' | 'verify' | 'benchmark-clone';

export async function writeReport(reportsDir: string, name: ReportName, data: unknown): Promise<string> {
  await fs.mkdir(reportsDir, { recursive: true });
  const file = path.join(reportsDir, `${name}.json`);
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, file);
  return file;
}

export async function readReport<T>(reportsDir: string, name: ReportName): Promise<T | undefined> {
  const file = path.join(reportsDir, `${name}.json`);
  if (!(await pathExists(file))) return undefined;
  return JSON.parse(await fs.readFile(file, 'utf8')) as T;
}

export async function readPackageJson(root: string): Promise<Record<string, unknown> | undefined> {
  const file = path.join(root, 'package.json');
  if (!(await pathExists(file))) return undefined;
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export function dependencyVersion(pkg: Record<string, unknown> | undefined, name: string): string | undefined {
  if (!pkg) return undefined;
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const deps = pkg[field];
    if (deps && typeof deps === 'object' && name in deps) {
      const value = (deps as Record<string, unknown>)[name];
      if (typeof value === 'string') return value;
    }
  }
  return undefined;
}
