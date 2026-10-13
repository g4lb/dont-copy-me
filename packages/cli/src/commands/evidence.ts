import { ExitCode } from '@dont-copy-me/core';
import { collectEvidence } from '@dont-copy-me/verify';
import { createContext, rel, type GlobalOptions } from '../context.js';
import { paint } from '../format.js';

export interface EvidenceCliOptions {
  dir?: string;
  render?: boolean;
  wayback?: boolean;
}

/** Records a dated hash manifest, search phrases and a takedown draft in .dcm/evidence/<time>/. */
export async function runEvidence(global: GlobalOptions, options: EvidenceCliOptions): Promise<number> {
  const ctx = await createContext(global);
  const { logger, project } = ctx;
  if (options.wayback) logger.info('Asking the Internet Archive to snapshot your public site (sends rights.siteUrl to web.archive.org).');
  const result = await collectEvidence({
    project,
    logger,
    ...(options.dir ? { dir: options.dir } : {}),
    ...(options.render === false ? { render: false } : {}),
    ...(options.wayback ? { wayback: true } : {}),
  });
  const m = result.manifest;
  ctx.emit({ dir: rel(project, result.dir), manifestSha256: result.manifestSha256, rootHash: m.rootHash, files: m.files.length, phrases: m.phrases, wayback: m.wayback ?? null });
  if (global.json) return ExitCode.Ok;
  logger.success(`Evidence written to ${rel(project, result.dir)}`);
  logger.info(`Recorded ${m.files.length} files from ${m.source} · root hash ${m.rootHash.slice(0, 16)}…`);
  logger.info(`Manifest SHA-256: ${result.manifestSha256}`);
  logger.info(`Search phrases: ${m.phrases.length} (phrases.txt) · takedown draft: takedown.md`);
  if (m.wayback) {
    if (m.wayback.snapshot) logger.info(`Internet Archive snapshot: ${m.wayback.snapshot}`);
    else logger.warn(`Internet Archive snapshot not confirmed (${m.wayback.error ?? `HTTP ${m.wayback.status}`}). Try again later or save it by hand at web.archive.org.`);
  }
  logger.info(paint('gray', 'Record the manifest hash somewhere with an independent date (email it to yourself, commit it, or timestamp it).'));
  return ExitCode.Ok;
}
