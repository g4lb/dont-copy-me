import fs from 'node:fs/promises';
import path from 'node:path';
import { ExitCode, resolveInside } from '@dont-copy-me/core';
import { loadModel, renderHtml, renderMarkdown } from '@dont-copy-me/reporter';
import { createContext, rel, type GlobalOptions } from '../context.js';

export interface ReportCliOptions {
  format?: string;
  out?: string;
}

export async function runReport(global: GlobalOptions, options: ReportCliOptions): Promise<number> {
  const ctx = await createContext(global);
  const { project, logger } = ctx;
  const format = options.format ?? 'markdown';
  const ext = format === 'markdown' ? 'md' : format;
  const file = options.out ? resolveInside(project.root, options.out, '--out') : path.join(project.dcmDir, `report.${ext}`);
  const model = await loadModel(project.root, project.reportsDir, path.join(project.dcmDir, 'bench', 'history.jsonl'));
  if (!model.protect && !model.verify && !model.clone) {
    logger.warn('No results yet. Run `dcm protect`, `dcm verify` or `dcm benchmark` first.');
  }
  const content = format === 'json' ? `${JSON.stringify(model, null, 2)}\n` : format === 'html' ? renderHtml(model, file) : renderMarkdown(model);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, 'utf8');
  if (global.json) ctx.emit({ file: rel(project, file), format });
  logger.success(`Report written to ${rel(project, file)}`);
  return ExitCode.Ok;
}
