import fs from 'node:fs/promises';
import path from 'node:path';
import { DcmError, ExitCode, pathExists } from '@dont-copy-me/core';
import { generateShieldFiles, robotsTxt, shieldOptionsFromConfig, tdmOptionsFromConfig } from '@dont-copy-me/shield';
import { createContext, rel, type GlobalOptions } from '../context.js';

export interface ShieldCliOptions {
  dryRun?: boolean;
  applyRobots?: boolean;
  force?: boolean;
}

/**
 * Writes rights-declaration templates (robots.txt, TDM headers, crawler rules) to .dcm/shield. The only file it can place in a deployable
 * directory is robots.txt, and only into the protected output, only with waf.enabled and
 * --apply-robots. DNS, CDN and firewall settings are never touched.
 */
export async function runShield(global: GlobalOptions, options: ShieldCliOptions): Promise<number> {
  const ctx = await createContext(global);
  const { project, logger } = ctx;
  const shieldOptions = shieldOptionsFromConfig(project.config.waf);
  const files = generateShieldFiles(shieldOptions, tdmOptionsFromConfig(project.config.rights));
  const dir = path.join(project.dcmDir, 'shield');
  if (options.dryRun) {
    for (const f of files) logger.info(`[dry-run] would write ${rel(project, path.join(dir, f.name))} (${f.content.length} bytes)`);
  } else {
    await fs.mkdir(dir, { recursive: true });
    for (const f of files) await fs.writeFile(path.join(dir, f.name), f.content, 'utf8');
    logger.success(`Templates written to ${rel(project, dir)} — review them before applying anything.`);
  }
  if (options.applyRobots) {
    if (!project.config.waf.enabled) {
      throw new DcmError('E_WAF_DISABLED', 'Refusing to apply robots.txt: waf.enabled is false', {
        hint: 'Set waf.enabled: true in dcm.config.ts to opt in.',
        exitCode: ExitCode.Usage,
      });
    }
    if (!(await pathExists(project.outputDir))) {
      throw new DcmError('E_NO_OUTPUT', 'Protected output not found', { hint: 'Run `dcm protect` first.', exitCode: ExitCode.Config });
    }
    const target = path.join(project.outputDir, 'robots.txt');
    if ((await pathExists(target)) && !options.force) {
      throw new DcmError('E_EXISTS', `${rel(project, target)} already exists`, { hint: 'Use --force to replace it.', exitCode: ExitCode.Usage });
    }
    if (options.dryRun) logger.info(`[dry-run] would write ${rel(project, target)}`);
    else {
      await fs.writeFile(target, robotsTxt(shieldOptions), 'utf8');
      logger.success(`Wrote ${rel(project, target)} (advisory: honored only by well-behaved crawlers)`);
    }
  }
  ctx.emit({ dir: rel(project, dir), files: files.map((f) => f.name), dryRun: Boolean(options.dryRun) });
  return ExitCode.Ok;
}
