import path from 'node:path';
import { createMatcher, ExitCode, listBackups, pathExists, readReport, walkFiles } from '@dont-copy-me/core';
import { buildFingerprint, type ProtectManifest } from '@dont-copy-me/notice';
import { createContext, rel, type GlobalOptions } from '../context.js';
import { paint } from '../format.js';

interface Stamped {
  createdAt: string;
  ok?: boolean;
}

async function inputFingerprint(dir: string, ignore: readonly string[]): Promise<string | undefined> {
  if (!(await pathExists(dir))) return undefined;
  const ignored = createMatcher(ignore);
  return buildFingerprint(dir, (await walkFiles(dir)).filter((f) => !ignored(f)));
}

export async function runStatus(global: GlobalOptions): Promise<number> {
  const ctx = await createContext(global);
  const { project, logger, loaded } = ctx;
  const manifest = await readReport<ProtectManifest>(project.reportsDir, 'protect');
  const verify = await readReport<Stamped>(project.reportsDir, 'verify');
  const clone = await readReport<Stamped>(project.reportsDir, 'benchmark-clone');
  const buildExists = await pathExists(project.inputDir);
  const outputExists = await pathExists(project.outputDir);
  // Same file selection as the pipeline, so the fingerprints are comparable.
  const currentInput = buildExists ? await inputFingerprint(project.inputDir, project.adapter.copyIgnore ?? []) : undefined;
  const stale = Boolean(manifest && currentInput && manifest.inputFingerprint !== currentInput);
  const backups = await listBackups(project.backupsDir, path.basename(project.outputDir));
  const status = {
    config: loaded.file ? rel(project, loaded.file) : null,
    framework: project.adapter.name,
    owner: project.config.rights.owner,
    build: { path: rel(project, project.inputDir), exists: buildExists },
    protected: {
      path: rel(project, project.outputDir),
      exists: outputExists,
      lastProtect: manifest?.createdAt ?? null,
      pages: manifest?.rights.html ?? null,
      staleInput: stale,
    },
    backups: backups.length,
    reports: {
      verify: verify ? { at: verify.createdAt, ok: verify.ok ?? null } : null,
      clone: clone?.createdAt ?? null,
    },
  };
  ctx.emit(status);
  if (global.json) return ExitCode.Ok;
  const yes = (v: boolean): string => (v ? paint('green', 'yes') : paint('yellow', 'no'));
  logger.info(`Config:      ${status.config ?? paint('yellow', 'none (defaults) — run `dcm init`')}`);
  logger.info(`Framework:   ${project.adapter.displayName} · rights holder ${status.owner}${project.config.rights.enabled ? '' : paint('yellow', ' (rights.enabled is false)')}`);
  logger.info(`Build:       ${status.build.path} (exists: ${yes(buildExists)})`);
  logger.info(`Protected:   ${status.protected.path} (exists: ${yes(outputExists)})`);
  if (manifest) {
    logger.info(`Last protect: ${manifest.createdAt} · notice on ${manifest.rights.html} page(s)`);
    if (stale) logger.warn('The build changed after the last `dcm protect`. Run it again before deploying.');
  } else {
    logger.info('Last protect: never');
  }
  logger.info(`Verify:      ${verify ? `${verify.createdAt} · ${verify.ok ? paint('green', 'passed') : paint('red', 'failed')}` : 'never'}`);
  logger.info(`Benchmark:   ${clone?.createdAt ?? 'never'}`);
  logger.info(`Backups:     ${backups.length}`);
  if (manifest && verify && new Date(verify.createdAt) < new Date(manifest.createdAt)) {
    logger.warn('Verification is older than the last protect run. Run `dcm verify`.');
  }
  return ExitCode.Ok;
}
