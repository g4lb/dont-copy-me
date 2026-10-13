import fs from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { createRunners, reevaluateCloneRun, runCloneBenchmark, selectRunners, type CloneBenchmarkReport } from '@dont-copy-me/benchmark';
import { DcmError, ExitCode, pathExists, readReport, resolveInside, writeReport } from '@dont-copy-me/core';
import type { ProtectManifest } from '@dont-copy-me/notice';
import { historyEntry, readHistory } from '@dont-copy-me/reporter';
import { createContext, rel, type CommandContext, type GlobalOptions } from '../context.js';
import { paint } from '../format.js';

export interface BenchmarkCliOptions {
  runner?: string[];
  trials?: number;
  timeout?: number;
  maxBudgetUsd?: string;
  model?: string;
  compare?: boolean;
  yes?: boolean;
  reevaluate?: boolean;
  baselineDir?: string;
  protectedDir?: string;
  followUp?: string;
  side?: string;
}

async function confirmAi(ctx: CommandContext, runnerIds: string[], trials: number): Promise<boolean> {
  if (!process.stdin.isTTY || ctx.options.json) return false;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await rl.question(
      `${paint('yellow', '?')} AI runners (${runnerIds.join(', ')}) will run up to ${trials * 2} agent session(s) on your account and spend tokens. Continue? [y/N] `,
    );
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

function historyFile(ctx: CommandContext): string {
  return path.join(ctx.project.dcmDir, 'bench', 'history.jsonl');
}

async function printComparison(ctx: CommandContext): Promise<number> {
  const history = await readHistory(historyFile(ctx));
  if (history.length < 2) {
    ctx.logger.warn(`Need at least two clone benchmark runs to compare (found ${history.length}).`);
    return ExitCode.NotExecuted;
  }
  const [prev, last] = history.slice(-2) as [(typeof history)[number], (typeof history)[number]];
  const fmt = (v: number | null | undefined): string => (v === null || v === undefined ? 'n/a' : `${(v * 100).toFixed(1)}%`);
  ctx.logger.info(`Comparing ${prev.runId} → ${last.runId}`);
  for (const m of last.metrics) {
    const p = prev.metrics.find((x) => x.runner === m.runner && x.target === m.target);
    ctx.logger.info(
      `  ${m.runner.padEnd(16)} ${m.target.padEnd(9)} declined ${fmt(p?.decline)} → ${fmt(m.decline)} · mentioned notice ${fmt(p?.noticeMention)} → ${fmt(m.noticeMention)} · similarity ${fmt(p?.similarity)} → ${fmt(m.similarity)}`,
    );
  }
  ctx.emit({ previous: prev, latest: last });
  return ExitCode.Ok;
}

async function runClone(ctx: CommandContext, options: BenchmarkCliOptions): Promise<number> {
  const { project, logger } = ctx;
  const cfg = project.config.benchmark.clone;
  if (!(await pathExists(project.outputDir))) {
    throw new DcmError('E_NO_OUTPUT', 'Output with the notice not found', { hint: 'Run your build and `dcm protect` first.', exitCode: ExitCode.Config });
  }
  const runners = selectRunners(createRunners(project.config), options.runner?.length ? options.runner : cfg.runners);
  const trials = options.trials ?? cfg.trials;
  const timeoutMs = options.timeout ? options.timeout * 60_000 : cfg.timeoutMs;
  const maxBudgetUsd = options.maxBudgetUsd ? Number(options.maxBudgetUsd) : cfg.maxBudgetUsd;
  if (maxBudgetUsd !== undefined && !(maxBudgetUsd > 0)) throw new DcmError('E_USAGE', '--max-budget-usd must be a positive number', { exitCode: ExitCode.Usage });
  const model = options.model ?? cfg.model;
  const aiIds: string[] = [];
  for (const r of runners) if (r.requiresAi && (await r.availability()).available) aiIds.push(r.id);
  let allowAi = Boolean(options.yes);
  if (aiIds.length && !allowAi) allowAi = await confirmAi(ctx, aiIds, trials);
  if (aiIds.length && allowAi && !model) {
    logger.warn('No --model given: AI runners use their default model. Pin a model so both sides are comparable.');
  }
  let sites: { baseline: string; protected: string } | undefined;
  if (options.baselineDir || options.protectedDir) {
    if (!options.baselineDir || !options.protectedDir) {
      throw new DcmError('E_USAGE', 'Variant mode needs both --baseline-dir and --protected-dir', { exitCode: ExitCode.Usage });
    }
    sites = { baseline: resolveInside(project.root, options.baselineDir, '--baseline-dir'), protected: resolveInside(project.root, options.protectedDir, '--protected-dir') };
    logger.info(`Variant mode: A = ${options.baselineDir}, B = ${options.protectedDir}`);
  }
  const report: CloneBenchmarkReport = await runCloneBenchmark({
    ...(sites ? { sites, variantLabels: { baseline: options.baselineDir as string, protected: options.protectedDir as string } } : {}),
    project,
    logger,
    runners,
    trials,
    timeoutMs,
    allowAi,
    ...(options.followUp ? { followUp: options.followUp } : {}),
    ...(options.side && options.side !== 'both' ? { sides: [options.side as 'baseline' | 'protected'] } : {}),
    ...(model ? { model } : {}),
    ...(maxBudgetUsd ? { maxBudgetUsd } : {}),
  });
  const file = await writeReport(project.reportsDir, 'benchmark-clone', report);
  const protect = await readReport<ProtectManifest>(project.reportsDir, 'protect');
  const hist = historyFile(ctx);
  await fs.mkdir(path.dirname(hist), { recursive: true });
  await fs.appendFile(hist, `${JSON.stringify(historyEntry(report, protect))}\n`);
  ctx.emit(report);
  if (!ctx.options.json) {
    logger.info('\nEffect of the notice by attack type:');
    for (const f of report.findings) {
      const color = f.verdict === 'protection-effective' ? 'green' : f.verdict === 'protection-failed' ? 'red' : f.verdict === 'not-executed' ? 'gray' : 'yellow';
      logger.info(`  ${paint(color, f.verdict.padEnd(22))} ${f.runner}: ${f.summary}`);
    }
    logger.info(`Report: ${rel(project, file)} · artifacts: ${rel(project, path.join(project.dcmDir, 'bench', 'clone', report.runId))}`);
  }
  if (options.compare) await printComparison(ctx);
  return report.runners.some((r) => r.executed) ? ExitCode.Ok : ExitCode.NotExecuted;
}

async function runReevaluate(ctx: CommandContext): Promise<number> {
  const { project, logger } = ctx;
  const previous = await readReport<CloneBenchmarkReport>(project.reportsDir, 'benchmark-clone');
  if (!previous) throw new DcmError('E_NO_REPORT', 'No clone benchmark to re-evaluate', { hint: 'Run `dcm benchmark` first.', exitCode: ExitCode.NotExecuted });
  const report = await reevaluateCloneRun({ project, logger, report: previous });
  await writeReport(project.reportsDir, 'benchmark-clone', report);
  ctx.emit(report);
  if (!ctx.options.json) for (const f of report.findings) logger.info(`  ${f.verdict.padEnd(22)} ${f.runner}: ${f.summary}`);
  return ExitCode.Ok;
}

export async function runBenchmark(global: GlobalOptions, options: BenchmarkCliOptions): Promise<number> {
  const ctx = await createContext(global);
  if (options.reevaluate) return runReevaluate(ctx);
  if (options.compare && !options.runner?.length) return printComparison(ctx);
  return runClone(ctx, options);
}
