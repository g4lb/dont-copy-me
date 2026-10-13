import { randomBytes } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DcmError } from './errors.js';
import { toPosix } from './paths.js';

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** Recursively lists regular files under `dir` as sorted forward-slash relative paths. */
export async function walkFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function visit(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(abs);
      else if (entry.isFile()) out.push(toPosix(path.relative(dir, abs)));
    }
  }
  await visit(dir);
  return out.sort();
}

/** Creates a private staging directory in the OS temp area, outside any source tree. */
export async function createStagingDir(prefix = 'dcm-'): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function copyDir(src: string, dest: string, ignore?: (relativePath: string) => boolean): Promise<void> {
  await fs.cp(src, dest, {
    recursive: true,
    force: false,
    errorOnExist: true,
    verbatimSymlinks: true,
    ...(ignore ? { filter: (source: string) => !ignore(toPosix(path.relative(src, source))) } : {}),
  });
}

async function moveDir(src: string, dest: string): Promise<void> {
  try {
    await fs.rename(src, dest);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    await copyDir(src, dest);
    await fs.rm(src, { recursive: true, force: true });
  }
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export interface PublishResult {
  output: string;
  backup: string | undefined;
}

/**
 * Publishes a fully prepared staging directory to `outputDir`.
 *
 * The staging copy is first materialized next to the output (same filesystem), then swapped in
 * with `rename`, so readers never observe a half-written protected build. A previous output is
 * moved into `backupsDir` and restored automatically if the swap fails.
 */
export async function atomicPublish(stagingDir: string, outputDir: string, backupsDir: string): Promise<PublishResult> {
  const incoming = `${outputDir}.dcm-incoming-${randomBytes(4).toString('hex')}`;
  await fs.mkdir(path.dirname(outputDir), { recursive: true });
  await copyDir(stagingDir, incoming);

  let backup: string | undefined;
  try {
    if (await pathExists(outputDir)) {
      await fs.mkdir(backupsDir, { recursive: true });
      backup = path.join(backupsDir, `${path.basename(outputDir)}-${timestamp()}`);
      await moveDir(outputDir, backup);
    }
    await fs.rename(incoming, outputDir);
  } catch (error) {
    if (backup && !(await pathExists(outputDir))) {
      await moveDir(backup, outputDir).catch(() => undefined);
    }
    await fs.rm(incoming, { recursive: true, force: true }).catch(() => undefined);
    throw new DcmError('E_PUBLISH', `Could not publish protected output to ${outputDir}`, { cause: error });
  }
  await pruneBackups(backupsDir, path.basename(outputDir), 3);
  return { output: outputDir, backup };
}

export async function listBackups(backupsDir: string, outputName: string): Promise<string[]> {
  if (!(await pathExists(backupsDir))) return [];
  const entries = await fs.readdir(backupsDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && e.name.startsWith(`${outputName}-`))
    .map((e) => path.join(backupsDir, e.name))
    .sort();
}

async function pruneBackups(backupsDir: string, outputName: string, keep: number): Promise<void> {
  const backups = await listBackups(backupsDir, outputName);
  for (const old of backups.slice(0, Math.max(0, backups.length - keep))) {
    await fs.rm(old, { recursive: true, force: true });
  }
}

/**
 * Restores the most recent backup of `outputDir`. The current output is preserved as a
 * `rolled-back-*` directory instead of being deleted.
 */
export async function rollbackOutput(outputDir: string, backupsDir: string): Promise<{ restored: string; preserved?: string }> {
  const backups = await listBackups(backupsDir, path.basename(outputDir));
  const latest = backups.at(-1);
  if (!latest) {
    throw new DcmError('E_NO_BACKUP', `No backup found for ${outputDir}`, {
      hint: 'Backups are created when `dcm protect` replaces an existing protected output.',
    });
  }
  let preserved: string | undefined;
  if (await pathExists(outputDir)) {
    preserved = path.join(backupsDir, `rolled-back-${path.basename(outputDir)}-${timestamp()}`);
    await moveDir(outputDir, preserved);
  }
  await moveDir(latest, outputDir);
  return preserved ? { restored: latest, preserved } : { restored: latest };
}
