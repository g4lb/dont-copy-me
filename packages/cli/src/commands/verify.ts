import { ExitCode, readReport, writeReport } from '@dont-copy-me/core';
import type { ProtectManifest } from '@dont-copy-me/notice';
import { verifyBuilds } from '@dont-copy-me/verify';
import { createContext, rel, type GlobalOptions } from '../context.js';
import { paint, statusIcon } from '../format.js';

export interface VerifyCliOptions {
  skipVisual?: boolean;
  skipPerf?: boolean;
}

export async function runVerify(global: GlobalOptions, options: VerifyCliOptions): Promise<number> {
  const ctx = await createContext(global);
  const { logger, project } = ctx;
  const manifest = await readReport<ProtectManifest>(project.reportsDir, 'protect');
  if (manifest && manifest.inputFingerprint) {
    logger.debug(`protect manifest from ${manifest.createdAt}`);
  }
  logger.step(`Comparing ${rel(project, project.inputDir)} (original) with ${rel(project, project.outputDir)} (with notice)`);
  const report = await verifyBuilds({
    project,
    logger,
    ...(manifest ? { protectManifest: manifest } : {}),
    ...(options.skipVisual ? { skipVisual: true } : {}),
    ...(options.skipPerf ? { skipPerformance: true } : {}),
  });
  const file = await writeReport(project.reportsDir, 'verify', report);
  ctx.emit(report);
  if (!global.json) {
    for (const check of report.checks) {
      logger.info(`${statusIcon(check.status)} ${check.title}`);
      if (check.status !== 'pass' || global.logLevel === 'debug') {
        for (const d of check.details) logger.info(`    ${paint('gray', d)}`);
      }
    }
    const s = report.summary;
    logger.info(`\n${s.pass} passed, ${s.fail} failed, ${s.warn} warnings, ${s.skip} skipped · report: ${rel(project, file)}`);
    if (report.ok) logger.success('The output carries the notice and otherwise behaves like the original.');
    else if (!report.budgetExceeded || report.checks.some((c) => c.status === 'fail' && c.category !== 'performance'))
      logger.error('Verification failed: the output differs from the original or lacks the notice. Do not deploy it.');
    else logger.error('Performance budget exceeded.');
  }
  if (report.ok) return ExitCode.Ok;
  const functional = report.checks.some((c) => c.status === 'fail' && c.category !== 'performance');
  return functional ? ExitCode.VerificationFailed : ExitCode.BudgetExceeded;
}
