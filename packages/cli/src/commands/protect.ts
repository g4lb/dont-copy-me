import { ExitCode, rollbackOutput, writeReport } from '@dont-copy-me/core';
import { protectBuild } from '@dont-copy-me/notice';
import { createContext, rel, type GlobalOptions } from '../context.js';
import { paint } from '../format.js';

export interface ProtectOptions {
  dryRun?: boolean;
}

export async function runProtect(global: GlobalOptions, options: ProtectOptions): Promise<number> {
  const ctx = await createContext(global);
  const { logger, project } = ctx;
  logger.step(`${options.dryRun ? '[dry-run] Planning' : 'Adding the rights notice to'} ${rel(project, project.inputDir)} → ${rel(project, project.outputDir)}`);
  const manifest = await protectBuild({ project, logger, ...(options.dryRun ? { dryRun: true } : {}) });
  if (!options.dryRun) await writeReport(project.reportsDir, 'protect', manifest);
  ctx.emit(manifest);
  if (global.json) return ExitCode.Ok;

  const r = manifest.rights;
  logger.info(`Notice: ${paint('gray', `"${r.notice}"`)}`);
  logger.info(`Pages: ${r.html} · source banners: ${r.css} CSS, ${r.js} JS${r.sourceMapsShifted ? ` (${r.sourceMapsShifted} source map(s) shifted)` : ''}${r.images ? ` · images with copyright metadata: ${r.images}` : ''}`);
  const meta = [r.structuredData && 'JSON-LD', r.noAiMeta && 'noai meta', r.tdmReservation && 'TDMRep (meta + /.well-known/tdmrep.json)', r.permissionRegistry && 'permission list (/.well-known/copy-permission.json)', r.siteUrl && 'canonical link'].filter(Boolean);
  logger.info(`Metadata: copyright meta${meta.length ? `, ${meta.join(', ')}` : ''}`);
  if (r.robots) logger.info(`robots.txt: mirroring-tool rules ${r.robots}`);
  if (r.copyBanner) logger.info(`Copy label: shown when a page is served anywhere except ${r.allowedHosts.join(', ')} (add staging hosts to rights.allowedHosts)`);
  if (manifest.integrityUpdates) logger.info(`Subresource Integrity: ${manifest.integrityUpdates} hash(es) updated`);
  for (const w of manifest.warnings) logger.warn(w);
  if (manifest.dryRun) {
    logger.success('[dry-run] Nothing was written.');
    return ExitCode.Ok;
  }
  if (manifest.backup) logger.info(`Previous output backed up to ${manifest.backup} (restore with \`dcm rollback\`)`);
  logger.success(`Notice added in ${(manifest.durationMs / 1000).toFixed(1)} s → ${manifest.output}`);
  logger.info('Next: run `dcm verify` before deploying the output.');
  return ExitCode.Ok;
}

export async function runRollback(global: GlobalOptions): Promise<number> {
  const ctx = await createContext(global);
  const result = await rollbackOutput(ctx.project.outputDir, ctx.project.backupsDir);
  ctx.emit(result);
  ctx.logger.success(`Restored ${rel(ctx.project, ctx.project.outputDir)} from ${rel(ctx.project, result.restored)}`);
  if (result.preserved) ctx.logger.info(`The replaced output was kept at ${rel(ctx.project, result.preserved)}`);
  return ExitCode.Ok;
}
