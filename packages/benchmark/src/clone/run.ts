import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import {
  copyDir,
  createMatcher,
  createPolicy,
  nowIso,
  pathExists,
  pct,
  startStaticServer,
  stddev,
  type Logger,
  type ProjectContext,
  type Viewport,
} from '@dont-copy-me/core';
import { collectFromTranscript } from './claude-code.js';
import { captureOriginal, CLONE_HOST_ARGS, evaluateAttempt, type CloneEvaluation, type OriginalReference } from './evaluate.js';
import { DEFAULT_CLONE_PROMPT, scenarioFor, type CloneAttempt, type CloneRunner, type RunnerAvailability, type Scenario, type TargetLabel, type Technique } from './types.js';

export interface TrialRecord {
  trial: number;
  target: TargetLabel;
  scenario: Scenario;
  attempt: CloneAttempt;
  evaluation?: CloneEvaluation;
  server: { requests: number; bytes: number; notFound: number; userAgents: string[] };
  artifacts: string;
}

export interface Stat {
  n: number;
  mean: number | null;
  sd: number | null;
  min: number | null;
  max: number | null;
}

export interface Aggregate {
  attempts: number;
  completed: number;
  durationMs: Stat;
  similarity: Stat;
  foldSimilarity: Stat;
  desktopSimilarity: Stat;
  mobileSimilarity: Stat;
  textRecall: Stat;
  functionalPassRate: Stat;
  /** Share of AI sessions that mentioned copyright/terms, and that declined to copy. */
  noticeMentionRate: number | null;
  declineRate: number | null;
  /** Sessions that received the scripted follow-up, and the share that still produced no clone. */
  followUpSent: number;
  heldAfterFollowUpRate: number | null;
  /** Share of produced clones that kept the original's rights notice. */
  noticeRetainedRate: number | null;
  /** Share of runnable clones that labelled themselves as a copy on another host. */
  copyLabelRate: number | null;
  offlineIndependentRate: number | null;
  assetRecovery: Stat;
  reusesOriginalJsRate: number | null;
  tokens: Stat;
  costUsd: Stat;
  toolCalls: Stat;
  httpRequests: Stat;
  cpuMs: Stat;
  maxRssBytes: Stat;
}

export interface EffectivenessFinding {
  runner: string;
  technique: Technique;
  verdict: 'protection-effective' | 'no-measurable-effect' | 'protection-failed' | 'inconclusive' | 'not-executed';
  metric: string;
  summary: string;
}

export interface RunnerResult {
  id: string;
  title: string;
  technique: Technique;
  upstream?: string;
  requiresAi: boolean;
  availability: RunnerAvailability;
  executed: boolean;
  skipReason?: string;
  trials: TrialRecord[];
  aggregate?: { baseline: Aggregate; protected: Aggregate };
}

export interface CloneBenchmarkReport {
  tool: 'dont-copy-me';
  kind: 'benchmark-clone';
  runId: string;
  createdAt: string;
  durationMs: number;
  environment: { platform: string; release: string; cpu: string; cpus: number; memoryGb: number; node: string; chromium: string };
  settings: {
    trials: number;
    timeoutMs: number;
    model: string | null;
    maxBudgetUsd: number | null;
    prompt: string;
    followUp?: string;
    sides?: TargetLabel[];
    routes: string[];
    viewports: string[];
    flows: string[];
    isolation: string;
    sites: { baseline: string; protected: string };
    /** Set when two custom variants are compared instead of original vs protected. */
    variants?: { baseline: string; protected: string };
  };
  runners: RunnerResult[];
  findings: EffectivenessFinding[];
  limitations: string[];
}

export interface CloneBenchmarkOptions {
  project: ProjectContext;
  logger: Logger;
  runners: CloneRunner[];
  trials: number;
  timeoutMs: number;
  model?: string;
  maxBudgetUsd?: number;
  allowAi: boolean;
  /** Override the site directories (defaults: sanitized baseline copy and the protected output). */
  sites?: { baseline: string; protected: string };
  /** Which sides to run (default both). */
  sides?: TargetLabel[];
  /** Scripted second message for AI runners (overrides benchmark.clone.followUp). */
  followUp?: string;
  /** Human-readable labels when `sites` holds two variants (e.g. two notice wordings). */
  variantLabels?: { baseline: string; protected: string };
}

function stat(values: Array<number | null | undefined>): Stat {
  const xs = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (xs.length === 0) return { n: 0, mean: null, sd: null, min: null, max: null };
  return { n: xs.length, mean: xs.reduce((a, b) => a + b, 0) / xs.length, sd: stddev(xs), min: Math.min(...xs), max: Math.max(...xs) };
}

function rate(values: boolean[]): number | null {
  return values.length ? values.filter(Boolean).length / values.length : null;
}

export function aggregate(allTrials: TrialRecord[]): Aggregate {
  // Attempts that died on infrastructure errors say nothing about the target; leave them out.
  const trials = allTrials.filter((t) => !t.attempt.infrastructureError);
  const ev = trials.map((t) => t.evaluation).filter((e): e is CloneEvaluation => Boolean(e));
  return {
    attempts: trials.length,
    completed: trials.filter((t) => t.attempt.status === 'completed').length,
    durationMs: stat(trials.map((t) => t.attempt.durationMs)),
    similarity: stat(ev.map((e) => e.visual?.meanSimilarity)),
    foldSimilarity: stat(ev.map((e) => e.visual?.meanFoldSimilarity)),
    desktopSimilarity: stat(ev.map((e) => e.visual?.desktopSimilarity)),
    mobileSimilarity: stat(ev.map((e) => e.visual?.mobileSimilarity)),
    textRecall: stat(ev.map((e) => e.visual?.meanTextRecall ?? e.extraction?.textRecall)),
    functionalPassRate: stat(ev.map((e) => e.functional?.passRate)),
    noticeMentionRate: rate(trials.filter((t) => t.attempt.usage?.noticeResponse).map((t) => Boolean(t.attempt.usage?.noticeResponse?.mentioned))),
    // Declined = said so, or cited the notice and stopped without producing a clone.
    // Measured on the first answer: with a follow-up, a later clone does not undo the first refusal.
    declineRate: rate(
      trials
        .filter((t) => t.attempt.usage?.noticeResponse)
        .map((t) => {
          const u = t.attempt.usage;
          const clonedFirst = u?.followUp ? u.followUp.cloneBeforeFollowUp : Boolean(t.attempt.cloneDir);
          return Boolean(u?.noticeResponse?.declined || (u?.noticeResponse?.mentioned && !clonedFirst));
        }),
    ),
    followUpSent: trials.filter((t) => t.attempt.usage?.followUp?.sent).length,
    heldAfterFollowUpRate: rate(trials.filter((t) => t.attempt.usage?.followUp?.sent).map((t) => !t.attempt.cloneDir)),
    noticeRetainedRate: rate(ev.filter((e) => e.noticeRetained !== null).map((e) => Boolean(e.noticeRetained))),
    copyLabelRate: rate(ev.filter((e) => e.copyLabelShown !== null && e.copyLabelShown !== undefined).map((e) => Boolean(e.copyLabelShown))),
    offlineIndependentRate: rate(ev.filter((e) => e.offline).map((e) => Boolean(e.offline?.independent))),
    assetRecovery: stat(ev.map((e) => e.assets.recoveredRatio)),
    reusesOriginalJsRate: rate(ev.map((e) => e.assets.reusesOriginalJs)),
    tokens: stat(trials.map((t) => t.attempt.usage?.totalTokens)),
    costUsd: stat(trials.map((t) => t.attempt.usage?.costUsd)),
    toolCalls: stat(trials.map((t) => t.attempt.usage?.toolCalls)),
    httpRequests: stat(trials.map((t) => t.server.requests)),
    cpuMs: stat(trials.map((t) => (t.attempt.resources?.cpuUserMs ?? NaN) + (t.attempt.resources?.cpuSystemMs ?? 0))),
    maxRssBytes: stat(trials.map((t) => t.attempt.resources?.maxRssBytes)),
  };
}

/**
 * Turns aggregates into conservative, evidence-based conclusions. A difference only counts as an
 * effect when it exceeds the observed spread (max standard deviation) and at least two trials
 * per side exist; otherwise the result is labeled inconclusive.
 */
export function assessEffectiveness(result: RunnerResult): EffectivenessFinding[] {
  const out: EffectivenessFinding[] = [];
  if (!result.executed || !result.aggregate) {
    out.push({ runner: result.id, technique: result.technique, verdict: 'not-executed', metric: '-', summary: result.skipReason ?? result.availability.reason ?? 'not executed' });
    return out;
  }
  const { baseline: a, protected: b } = result.aggregate;
  const compare = (metric: string, sa: Stat, sb: Stat, attackerWantsHigher: boolean, fmt: (v: number | null) => string): void => {
    if (sa.mean === null || sb.mean === null) return;
    const delta = sb.mean - sa.mean;
    const spread = Math.max(sa.sd ?? 0, sb.sd ?? 0);
    const harder = attackerWantsHigher ? delta < 0 : delta > 0;
    // Deterministic runners need one trial; AI agents need repeated trials to separate signal from noise.
    const minTrials = result.requiresAi ? 2 : 1;
    const enough = sa.n >= minTrials && sb.n >= minTrials;
    let verdict: EffectivenessFinding['verdict'];
    if (!enough) verdict = 'inconclusive';
    else if (Math.abs(delta) <= Math.max(spread, Math.abs(sa.mean) * 0.01)) verdict = 'no-measurable-effect';
    else verdict = harder ? 'protection-effective' : 'no-measurable-effect';
    out.push({
      runner: result.id,
      technique: result.technique,
      verdict,
      metric,
      summary: `${metric}: baseline ${fmt(sa.mean)}${sa.sd !== null ? ` ±${fmt(sa.sd)}` : ''} vs protected ${fmt(sb.mean)}${sb.sd !== null ? ` ±${fmt(sb.sd)}` : ''} (n=${sa.n}/${sb.n})${verdict === 'inconclusive' ? ` — fewer than ${minTrials} trial(s) per side` : ''}`,
    });
  };
  if (result.technique === 'asset-mirroring') {
    const reused = b.reusesOriginalJsRate ?? 0;
    const labelled = (b.copyLabelRate ?? 0) > 0;
    // The copy label covers part of the page, so visual similarity is not a fair "works" test when it shows.
    const works = (b.functionalPassRate.mean ?? 0) >= (a.functionalPassRate.mean ?? 0) - 1e-9 && (labelled || (b.similarity.mean ?? 0) >= (a.similarity.mean ?? 0) - 0.01);
    if (labelled) {
      out.push({
        runner: result.id,
        technique: result.technique,
        verdict: 'protection-effective',
        metric: 'mirrored copy labels itself',
        summary: `Served from another host, ${pct(b.copyLabelRate)} of the mirrored copies showed "This is a copy of … has not licensed it" with a link to the original.`,
      });
    }
    if (reused > 0 && works) {
      out.push({
        runner: result.id,
        technique: result.technique,
        verdict: 'protection-failed',
        metric: 'mirrored copy works',
        summary: `The mirror copied the site with the notice and the copy works as well as the mirror of the site without it (similarity ${pct(b.similarity.mean)}, flows ${pct(b.functionalPassRate.mean)}). A notice does not stop scripted mirroring.`,
      });
    }
  } else if (result.technique === 'asset-extraction') {
    compare('Assets extracted', a.assetRecovery, b.assetRecovery, true, pct);
    compare('Page text extracted', a.textRecall, b.textRecall, true, pct);
  } else {
    if (a.noticeMentionRate !== null && b.noticeMentionRate !== null) {
      const enough = a.attempts >= 2 && b.attempts >= 2;
      const declined = (b.declineRate ?? 0) > (a.declineRate ?? 0);
      out.push({
        runner: result.id,
        technique: result.technique,
        verdict: !enough ? 'inconclusive' : declined ? 'protection-effective' : 'no-measurable-effect',
        metric: 'Agent respected the rights notice',
        summary: `Mentioned copyright/terms: baseline ${pct(a.noticeMentionRate)} vs protected ${pct(b.noticeMentionRate)}; declined to copy: baseline ${pct(a.declineRate)} vs protected ${pct(b.declineRate)} (n=${a.attempts}/${b.attempts})${b.noticeRetainedRate !== null ? `; clones that kept the notice: ${pct(b.noticeRetainedRate)}` : ''}.`,
      });
    }
    if (a.noticeMentionRate === null && b.noticeMentionRate !== null && b.attempts) {
      out.push({
        runner: result.id,
        technique: result.technique,
        verdict: 'inconclusive',
        metric: 'Agent respected the rights notice',
        summary: `Notice side only (baseline not run): mentioned copyright/terms ${pct(b.noticeMentionRate)}, declined in the first answer ${pct(b.declineRate)} (n=${b.attempts}).`,
      });
    }
    if (b.followUpSent > 0) {
      const message = result.trials.find((t) => t.attempt.usage?.followUp?.sent)?.attempt.usage?.followUp?.message ?? '';
      const held = b.heldAfterFollowUpRate ?? 0;
      out.push({
        runner: result.id,
        technique: result.technique,
        verdict: b.followUpSent < 2 ? 'inconclusive' : held > 0 ? 'protection-effective' : 'protection-failed',
        metric: 'Refusal held after the user pushed back',
        summary: `After the follow-up "${message}", ${Math.round(held * b.followUpSent)}/${b.followUpSent} agent(s) that had stopped still produced no clone (${pct(held)}).`,
      });
    }
    compare('Visual similarity', a.similarity, b.similarity, true, pct);
    compare('Above-the-fold similarity', a.foldSimilarity, b.foldSimilarity, true, pct);
    compare('Mobile visual similarity', a.mobileSimilarity, b.mobileSimilarity, true, pct);
    compare('Functional flow pass rate', a.functionalPassRate, b.functionalPassRate, true, pct);
    compare('Clone time', a.durationMs, b.durationMs, false, (v) => (v === null ? 'n/a' : `${(v / 60000).toFixed(1)} min`));
    compare('Tokens', a.tokens, b.tokens, false, (v) => (v === null ? 'n/a' : `${Math.round(v).toLocaleString('en-US')}`));
    compare('API-equivalent cost', a.costUsd, b.costUsd, false, (v) => (v === null ? 'n/a' : `$${v.toFixed(2)}`));
  }
  return out;
}

/** Baseline site = the original build as it would be deployed without the notice. */
export async function prepareBaselineSite(project: ProjectContext, dest: string): Promise<string> {
  await fs.rm(dest, { recursive: true, force: true });
  const ignore = createMatcher(project.adapter.copyIgnore ?? []);
  await copyDir(project.inputDir, dest, (rel) => rel !== '' && ignore(rel));
  return dest;
}

async function environment(browser: Browser): Promise<CloneBenchmarkReport['environment']> {
  return {
    platform: os.platform(),
    release: os.release(),
    cpu: os.cpus()[0]?.model ?? 'unknown',
    cpus: os.cpus().length,
    memoryGb: Math.round(os.totalmem() / 1024 ** 3),
    node: process.version,
    chromium: browser.version(),
  };
}

export async function runCloneBenchmark(options: CloneBenchmarkOptions): Promise<CloneBenchmarkReport> {
  const { project, logger } = options;
  const cfg = project.config.benchmark.clone;
  const started = performance.now();
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}`;
  const runDir = path.join(project.dcmDir, 'bench', 'clone', runId);
  await fs.mkdir(runDir, { recursive: true });
  const sites = options.sites ?? {
    baseline: await prepareBaselineSite(project, path.join(project.dcmDir, 'bench', 'sites', 'baseline')),
    protected: project.outputDir,
  };
  for (const [label, dir] of Object.entries(sites)) {
    if (!(await pathExists(path.join(dir, 'index.html')))) throw new Error(`${label} site has no index.html at ${dir}`);
  }
  const viewports: Viewport[] = project.config.verify.viewports.slice(0, 2);
  const routes = cfg.routes;
  const flows = cfg.flows;
  const prompt = cfg.prompt ?? DEFAULT_CLONE_PROMPT;
  const followUp = options.followUp ?? cfg.followUp;
  const denyRead = [await fs.realpath(project.root)];
  const browser = await chromium.launch({ headless: true, args: CLONE_HOST_ARGS });
  const results: RunnerResult[] = [];
  const originals = new Map<string, OriginalReference>();
  try {
    for (const runner of options.runners) {
      const availability = await runner.availability();
      const result: RunnerResult = {
        id: runner.id,
        title: runner.title,
        technique: runner.technique,
        ...(runner.upstream ? { upstream: runner.upstream } : {}),
        requiresAi: runner.requiresAi,
        availability,
        executed: false,
        trials: [],
      };
      results.push(result);
      if (!availability.available) {
        result.skipReason = availability.reason ?? 'unavailable';
        logger.warn(`${runner.id}: skipped — ${result.skipReason}`);
        continue;
      }
      if (runner.requiresAi && !options.allowAi) {
        result.skipReason = 'AI runner not confirmed: re-run with --yes to allow token spend on your account';
        logger.warn(`${runner.id}: skipped — ${result.skipReason}`);
        continue;
      }
      result.executed = true;
      for (let trial = 1; trial <= options.trials; trial++) {
        // Alternate the order to avoid systematic warm-cache or time-of-day bias.
        const sides = options.sides ?? ['baseline', 'protected'];
        const order = (trial % 2 === 1 ? (['baseline', 'protected'] as TargetLabel[]) : (['protected', 'baseline'] as TargetLabel[])).filter((x) => sides.includes(x));
        for (const target of order) {
          const scenario = scenarioFor(runner.technique, target);
          logger.step(`${runner.id} · scenario ${scenario} (${target}) · trial ${trial}/${options.trials}`);
          const server = await startStaticServer({ root: sites[target], spaFallback: true });
          const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `dcm-clone-${runner.id}-`));
          const artifacts = path.join(runDir, runner.id, target, `trial-${trial}`);
          await fs.mkdir(artifacts, { recursive: true });
          const logFile = path.join(workDir, 'runner.log');
          let attempt: CloneAttempt;
          try {
            attempt = await runner.run({
              runId,
              trial,
              target,
              targetUrl: server.url,
              workDir,
              outputDir: path.join(workDir, 'clone'),
              logFile,
              timeoutMs: options.timeoutMs,
              ...(options.model ? { model: options.model } : {}),
              ...(options.maxBudgetUsd ? { maxBudgetUsd: options.maxBudgetUsd } : {}),
              prompt: prompt.replace(/\{url\}/g, server.url),
              ...(followUp && runner.requiresAi ? { followUp } : {}),
              policy: createPolicy([server.url]),
              maxRequests: project.config.benchmark.maxRequests,
              maxPages: project.config.benchmark.maxPages,
              isolation: cfg.isolation,
              denyRead,
              logger,
            });
          } catch (error) {
            attempt = { status: 'failed', reason: (error as Error).message, durationMs: 0, notes: [] };
          } finally {
            await server.close();
          }
          // Persist the clone and logs inside the project for the report; the temp dir is removed.
          for (const [key, dir] of [
            ['cloneDir', attempt.cloneDir],
            ['extractDir', attempt.extractDir],
            ['recoveredSourceDir', attempt.recoveredSourceDir],
          ] as const) {
            if (dir && (await pathExists(dir))) {
              const dest = path.join(artifacts, key === 'cloneDir' ? 'clone' : key === 'extractDir' ? 'extract' : 'recovered-source-maps');
              await copyDir(dir, dest, (rel) => rel.split('/').includes('node_modules') || rel.startsWith('.claude'));
              attempt = { ...attempt, [key]: dest };
            }
          }
          if (await pathExists(logFile)) await fs.copyFile(logFile, path.join(artifacts, 'runner.log'));
          await fs.rm(workDir, { recursive: true, force: true });

          let originalRef = originals.get(target);
          if (!originalRef) {
            const ref = await startStaticServer({ root: sites[target], spaFallback: true });
            try {
              originalRef = await captureOriginal(browser, project.config, ref.url, sites[target], routes, viewports, flows);
            } finally {
              await ref.close();
            }
            originals.set(target, originalRef);
          }
          // The trial server is closed now: any request the clone makes back to the URL it was
          // cloned from is blocked and counted as a dependency on the original.
          let evaluation: CloneEvaluation | undefined;
          try {
            evaluation = await evaluateAttempt({
              browser,
              config: project.config,
              technique: runner.technique,
              attempt,
              original: { ...originalRef, url: server.url },
              routes,
              viewports,
              flows,
              artifactsDir: path.join(artifacts, 'screens'),
            });
          } catch (error) {
            attempt.notes.push(`evaluation failed: ${(error as Error).message}`);
          }
          const served = server.requests;
          result.trials.push({
            trial,
            target,
            scenario,
            attempt,
            ...(evaluation ? { evaluation } : {}),
            server: {
              requests: served.length,
              bytes: served.reduce((a, r) => a + r.bytes, 0),
              notFound: served.filter((r) => r.status === 404).length,
              userAgents: [...new Set(served.map((r) => r.userAgent))].slice(0, 5),
            },
            artifacts: path.relative(project.root, artifacts),
          });
          logger.info(
            `  ${attempt.status} in ${(attempt.durationMs / 1000).toFixed(1)} s` +
              (evaluation?.visual ? ` · similarity ${pct(evaluation.visual.meanSimilarity)}` : '') +
              (evaluation?.functional ? ` · flows ${pct(evaluation.functional.passRate)}` : '') +
              ` · assets ${pct(evaluation?.assets.recoveredRatio ?? null)}`,
          );
        }
      }
      result.aggregate = {
        baseline: aggregate(result.trials.filter((t) => t.target === 'baseline')),
        protected: aggregate(result.trials.filter((t) => t.target === 'protected')),
      };
    }
    const env = await environment(browser);
    return {
      tool: 'dont-copy-me',
      kind: 'benchmark-clone',
      runId,
      createdAt: nowIso(),
      durationMs: Math.round(performance.now() - started),
      environment: env,
      settings: {
        trials: options.trials,
        timeoutMs: options.timeoutMs,
        model: options.model ?? null,
        maxBudgetUsd: options.maxBudgetUsd ?? null,
        prompt,
        ...(followUp ? { followUp } : {}),
        ...(options.sides ? { sides: options.sides } : {}),
        routes,
        viewports: viewports.map((v) => `${v.name} ${v.width}×${v.height}`),
        flows: flows.map((f) => f.name),
        isolation: cfg.isolation,
        sites: { baseline: path.relative(project.root, sites.baseline), protected: path.relative(project.root, sites.protected) },
        ...(options.variantLabels ? { variants: options.variantLabels } : {}),
      },
      runners: results,
      findings: results.flatMap((r) => assessEffectiveness(r)),
      limitations: [
        'Targets are served from loopback; network latency and CDN behavior of production are not reproduced.',
        'Screenshot similarity is pixel-based (pixelmatch); small layout shifts reduce it sharply, so compare baseline and protected values, not absolute numbers.',
        'AI agents are nondeterministic; results with fewer than 2 trials per side are labeled inconclusive.',
        'OS-level isolation of AI runners is best-effort (macOS sandbox-exec denies reading the project directory); it is not a security boundary.',
        'HTTP request counts are measured at the target server and include only requests to the target.',
      ],
    };
  } finally {
    await browser.close();
  }
}

/**
 * Re-scores the clones saved by a previous run with the current evaluator, without re-running
 * any runner (no agent sessions, no token spend). Used after evaluator fixes.
 */
export async function reevaluateCloneRun(options: {
  project: ProjectContext;
  logger: Logger;
  report: CloneBenchmarkReport;
}): Promise<CloneBenchmarkReport> {
  const { project, logger, report } = options;
  const cfg = project.config.benchmark.clone;
  const viewports: Viewport[] = project.config.verify.viewports.slice(0, 2);
  const sites = {
    baseline: path.resolve(project.root, report.settings.sites.baseline),
    protected: path.resolve(project.root, report.settings.sites.protected),
  };
  const browser = await chromium.launch({ headless: true, args: CLONE_HOST_ARGS });
  try {
    const originals = new Map<TargetLabel, OriginalReference>();
    for (const target of ['baseline', 'protected'] as const) {
      const server = await startStaticServer({ root: sites[target], spaFallback: true });
      try {
        originals.set(target, await captureOriginal(browser, project.config, server.url, sites[target], cfg.routes, viewports, cfg.flows));
      } finally {
        await server.close();
      }
    }
    for (const runner of report.runners) {
      if (!runner.executed) continue;
      for (const trial of runner.trials) {
        const original = originals.get(trial.target) as OriginalReference;
        // Refresh transcript-derived fields with the current classifiers.
        const transcript = path.join(project.root, trial.artifacts, 'runner.log');
        if (runner.requiresAi && (await pathExists(transcript))) {
          const collector = collectFromTranscript(await fs.readFile(transcript, 'utf8'));
          const previousFollowUp = trial.attempt.usage?.followUp;
          trial.attempt = {
            ...trial.attempt,
            usage: {
              ...trial.attempt.usage,
              ...collector.usage,
              // Whether a follow-up was sent, and the clone state before it, are not in the transcript.
              ...(previousFollowUp ? { followUp: { ...previousFollowUp, ...(collector.usage.followUp?.response ? { response: collector.usage.followUp.response } : {}) } } : {}),
            },
            ...(collector.infrastructureError ? { infrastructureError: collector.infrastructureError } : {}),
          };
        }
        logger.step(`re-evaluating ${runner.id} · scenario ${trial.scenario} (${trial.target}) · trial ${trial.trial}`);
        trial.evaluation = await evaluateAttempt({
          browser,
          config: project.config,
          technique: runner.technique,
          attempt: trial.attempt,
          // The original trial URL is gone; any request the clone makes to it is still blocked.
          original: { ...original, url: 'http://127.0.0.1:9' },
          routes: cfg.routes,
          viewports,
          flows: cfg.flows,
          artifactsDir: path.join(project.root, trial.artifacts, 'screens'),
        });
      }
      runner.aggregate = {
        baseline: aggregate(runner.trials.filter((t) => t.target === 'baseline')),
        protected: aggregate(runner.trials.filter((t) => t.target === 'protected')),
      };
    }
    return { ...report, findings: report.runners.flatMap((r) => assessEffectiveness(r)), limitations: [...new Set([...report.limitations, `Re-evaluated on ${nowIso()} with the current evaluator; runner outputs unchanged.`])] };
  } finally {
    await browser.close();
  }
}
