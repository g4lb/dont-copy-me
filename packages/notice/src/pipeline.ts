import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  atomicPublish,
  copyDir,
  createMatcher,
  createStagingDir,
  DcmError,
  ExitCode,
  nowIso,
  pathExists,
  sha256,
  walkFiles,
  type Logger,
  type ProjectContext,
} from '@dont-copy-me/core';
import { checkReferences, updateIntegrityAttributes } from './integrity.js';
import { ensurePermissionKey, publicKeyString } from './permission-token.js';
import { allowedHosts, applyRights, type RightsResult } from './rights.js';

export interface ProtectOptions {
  project: ProjectContext;
  logger: Logger;
  dryRun?: boolean;
}

export interface ProtectManifest {
  tool: 'dont-copy-me';
  version: 2;
  createdAt: string;
  dryRun: boolean;
  framework: string;
  input: string;
  output: string;
  inputFingerprint: string;
  outputFingerprint?: string;
  backup?: string;
  durationMs: number;
  rights: Omit<RightsResult, 'changed'> & {
    owner: string;
    termsUrl: string | null;
    contact: string | null;
    siteUrl: string | null;
    visible: boolean;
    sourceBanners: boolean;
    structuredData: boolean;
    noAiMeta: boolean;
    tdmReservation: boolean;
    imageMetadata: boolean;
    allowedHosts: string[];
  };
  integrityUpdates: number;
  warnings: string[];
  limitations: string[];
}

/** Cheap fingerprint of the input build (names, sizes, mtimes) used to detect a stale output. */
export async function buildFingerprint(dir: string, files: string[]): Promise<string> {
  const parts: string[] = [];
  for (const file of files) {
    const stat = await fs.stat(path.join(dir, file));
    parts.push(`${file}:${stat.size}:${Math.round(stat.mtimeMs)}`);
  }
  return sha256(parts.join('\n')).slice(0, 16);
}

async function contentFingerprint(dir: string, files: string[]): Promise<string> {
  const parts: string[] = [];
  for (const file of files) parts.push(`${file}:${sha256(await fs.readFile(path.join(dir, file)))}`);
  return sha256(parts.join('\n')).slice(0, 16);
}

export const NOTICE_LIMITATIONS = [
  'A rights notice states your terms; it does not technically prevent copying. Scripted mirroring tools ignore it.',
  'AI agents that notice it usually stop and ask their user; a user who claims to own the site or to have permission will usually get the clone.',
  'Whether a notice or a TDM reservation is enforceable depends on your jurisdiction. This is not legal advice.',
];

/**
 * Writes the build with the rights notice to the output directory:
 * stage a copy in the OS temp dir → add notice, metadata and banners → update SRI hashes
 * → check references → atomic publish. The input build is never written to.
 */
export async function protectBuild(options: ProtectOptions): Promise<ProtectManifest> {
  const { project, logger } = options;
  const config = project.config;
  const rights = config.rights;
  const started = performance.now();
  const warnings: string[] = [];

  if (!rights.enabled) {
    throw new DcmError('E_RIGHTS_DISABLED', 'rights.enabled is false: there is nothing to add', {
      hint: 'Set rights.enabled: true (and rights.owner) in dcm.config.ts.',
      exitCode: ExitCode.Config,
    });
  }
  if (rights.owner === 'the site owner') warnings.push('rights.owner is not set: the notice names "the site owner". Set your legal name.');
  if (rights.copyBanner && !rights.siteUrl) warnings.push('rights.copyBanner needs rights.siteUrl: copies will not be labelled.');
  if (!rights.termsUrl && !rights.contact) warnings.push('Neither rights.termsUrl nor rights.contact is set: readers have no way to ask for permission.');
  if (!(await pathExists(project.inputDir))) {
    throw new DcmError('E_NO_BUILD', `Build output not found at ${path.relative(project.root, project.inputDir) || '.'}`, {
      hint: 'Run your production build first (for example `npm run build`), or set `input` in dcm.config.ts.',
      exitCode: ExitCode.Config,
    });
  }
  const ignoreCopy = createMatcher(project.adapter.copyIgnore ?? []);
  const files = (await walkFiles(project.inputDir)).filter((f) => !ignoreCopy(f));
  if (files.length === 0) {
    throw new DcmError('E_EMPTY_BUILD', `Build output at ${project.inputDir} is empty`, { exitCode: ExitCode.Config });
  }
  if (!files.some((f) => /\.html?$/i.test(f))) {
    warnings.push('The build has no HTML files: only source banners and tdmrep.json can be added. Server-rendered pages need the notice in your templates.');
  }
  const inputFingerprint = await buildFingerprint(project.inputDir, files);
  const mapUrl = project.adapter.urlToBuildPath?.bind(project.adapter);

  const staging = await createStagingDir('dcm-protect-');
  const stagedBuild = path.join(staging, 'build');
  try {
    await copyDir(project.inputDir, stagedBuild, (rel) => rel !== '' && ignoreCopy(rel));
    let publicKey: string | undefined;
    if (rights.signedPermissions && rights.permissionRegistry) {
      const keyFile = path.resolve(project.root, rights.keyFile);
      const inside = (dir: string): boolean => !path.relative(dir, keyFile).startsWith('..') && !path.isAbsolute(path.relative(dir, keyFile));
      if (inside(project.inputDir) || inside(project.outputDir)) {
        throw new DcmError('E_KEY_IN_BUILD', `rights.keyFile (${rights.keyFile}) is inside a build directory and would be deployed`, {
          hint: 'Keep the private key outside input and output, for example .dcm/permission-key.pem.',
          exitCode: ExitCode.Config,
        });
      }
      const { key, created } = options.dryRun && !(await pathExists(keyFile)) ? { key: undefined, created: false } : await ensurePermissionKey(keyFile);
      if (created) warnings.push(`Created the permission signing key at ${path.relative(project.root, keyFile)}. Keep it private and back it up: it issues tokens with \`dcm grant\`.`);
      if (key) publicKey = publicKeyString(crypto.createPublicKey(key));
      else warnings.push('Dry run: the permission signing key does not exist yet and would be created.');
    }
    const applied = await applyRights(stagedBuild, files, rights, undefined, publicKey);
    const banners = new Map([...applied.changed].filter(([f]) => /\.(?:m?js|css)$/i.test(f)));
    const integrityUpdates = await updateIntegrityAttributes(stagedBuild, await walkFiles(stagedBuild), banners, mapUrl);
    const stagedFiles = await walkFiles(stagedBuild);
    const brokenRefs = await checkReferences(stagedBuild, stagedFiles, mapUrl);
    if (brokenRefs.length > 0) {
      throw new DcmError('E_BROKEN_REFERENCES', `Output has broken references:\n  ${brokenRefs.slice(0, 20).join('\n  ')}`, {
        hint: 'No output was written. Check that the input build is complete.',
      });
    }
    const { changed: _changed, ...counts } = applied;
    const manifestRights: ProtectManifest['rights'] = {
      ...counts,
      owner: rights.owner,
      termsUrl: rights.termsUrl ?? null,
      contact: rights.contact ?? null,
      siteUrl: rights.siteUrl ?? null,
      visible: rights.visible,
      sourceBanners: rights.sourceBanners,
      structuredData: rights.structuredData,
      noAiMeta: rights.noAiMeta,
      tdmReservation: rights.tdmReservation,
      imageMetadata: rights.imageMetadata,
      allowedHosts: rights.copyBanner && rights.siteUrl ? allowedHosts(rights) : [],
    };
    const base = {
      tool: 'dont-copy-me' as const,
      version: 2 as const,
      framework: project.adapter.name,
      input: path.relative(project.root, project.inputDir) || '.',
      output: path.relative(project.root, project.outputDir) || '.',
      inputFingerprint,
      rights: manifestRights,
      integrityUpdates,
      warnings,
      limitations: [...NOTICE_LIMITATIONS, ...project.adapter.limitations],
    };
    if (options.dryRun) {
      return { ...base, createdAt: nowIso(), dryRun: true, durationMs: performance.now() - started };
    }
    const outputFingerprint = await contentFingerprint(stagedBuild, stagedFiles);
    const published = await atomicPublish(stagedBuild, project.outputDir, project.backupsDir);
    logger.debug(`published ${stagedFiles.length} files to ${project.outputDir}`);
    return {
      ...base,
      createdAt: nowIso(),
      dryRun: false,
      outputFingerprint,
      ...(published.backup ? { backup: path.relative(project.root, published.backup) } : {}),
      durationMs: performance.now() - started,
    };
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}
