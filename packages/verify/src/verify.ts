import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import {
  DcmError,
  ExitCode,
  nowIso,
  pathExists,
  pctChange,
  slug,
  walkFiles,
  type Logger,
  type ProjectContext,
  type Viewport,
} from '@dont-copy-me/core';
import { RIGHTS_ATTR, type ProtectManifest } from '@dont-copy-me/notice';
import { capturePage, newStableContext, type A11ySummary, type PageCapture } from './capture.js';
import { runFlow, type FlowResult } from './flows.js';
import { comparePngs, cropHeight } from './image.js';
import { measureLoads, type PerfSummary } from './perf.js';
import { startTarget, type RunningTarget } from './targets.js';

export type CheckStatus = 'pass' | 'fail' | 'warn' | 'skip';

export interface Check {
  id: string;
  category: 'route' | 'visual' | 'flow' | 'console' | 'a11y' | 'performance' | 'notice';
  status: CheckStatus;
  title: string;
  details: string[];
  artifacts?: Record<string, string>;
}

export interface VerifyReport {
  tool: 'dont-copy-me';
  kind: 'verify';
  createdAt: string;
  ok: boolean;
  budgetExceeded: boolean;
  baseline: string;
  protected: string;
  routes: string[];
  viewports: string[];
  checks: Check[];
  performance?: { baseline: PerfSummary; protected: PerfSummary };
  summary: Record<CheckStatus, number>;
  durationMs: number;
}

export interface VerifyOptions {
  project: ProjectContext;
  logger: Logger;
  baselineDir?: string;
  protectedDir?: string;
  protectManifest?: ProtectManifest;
  skipVisual?: boolean;
  skipPerformance?: boolean;
  artifactsDir?: string;
}

/** Normalizes messages so the same error in both builds compares equal (hashes, positions). */
function normalizeMessage(text: string): string {
  return text
    .replace(/https?:\/\/127\.0\.0\.1:\d+/g, '<origin>')
    .replace(/[A-Za-z0-9_-]{8}\.(js|css)/g, '<hash>.$1')
    .replace(/:\d+:\d+/g, '')
    .replace(/_0x[0-9a-f]+/g, '<id>');
}

function newIssues(baseline: string[], protectedList: string[]): string[] {
  const base = new Set(baseline.map(normalizeMessage));
  return protectedList.filter((m) => !base.has(normalizeMessage(m)));
}

function a11yRegressions(a: A11ySummary, b: A11ySummary): string[] {
  const out: string[] = [];
  for (const key of Object.keys(a) as Array<keyof A11ySummary>) {
    const before = Number(a[key]);
    const after = Number(b[key]);
    if (after > before) out.push(`${key}: ${before} → ${after}`);
  }
  return out;
}

async function discoverRoutes(browser: Browser, target: RunningTarget, project: ProjectContext, viewport: Viewport): Promise<string[]> {
  const cfg = project.config.verify;
  const routes = [...new Set(cfg.routes)];
  if (!cfg.crawl) return routes;
  const context = await newStableContext(browser, viewport, project.config.browser);
  try {
    const queue = [...routes];
    const seen = new Set(routes);
    while (queue.length > 0 && seen.size <= cfg.maxPages) {
      const route = queue.shift() as string;
      const page = await context.newPage();
      try {
        await page.goto(new URL(route, target.url).toString(), { waitUntil: 'load', timeout: cfg.navigationTimeoutMs });
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
        const hrefs = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => (a as HTMLAnchorElement).href));
        for (const href of hrefs) {
          const url = new URL(href);
          if (url.origin !== new URL(target.url).origin) continue;
          if (/\.[a-z0-9]{2,5}$/i.test(url.pathname) && !url.pathname.endsWith('.html')) continue;
          if (!seen.has(url.pathname) && seen.size < cfg.maxPages) {
            seen.add(url.pathname);
            queue.push(url.pathname);
          }
        }
      } finally {
        await page.close();
      }
    }
    return [...seen];
  } finally {
    await context.close();
  }
}

/** Every HTML page of the output must carry the notice (visible line or metadata). */
async function noticeCheck(protectedDir: string, manifest: ProtectManifest | undefined): Promise<Check> {
  const pages = (await walkFiles(protectedDir)).filter((f) => /\.html?$/i.test(f));
  const missing: string[] = [];
  for (const page of pages) if (!(await fs.readFile(path.join(protectedDir, page), 'utf8')).includes(RIGHTS_ATTR)) missing.push(page);
  const details = missing.length ? missing.slice(0, 10).map((p) => `no notice: ${p}`) : [`${pages.length} page(s) carry the notice`];
  if (manifest?.rights.notice) details.push(`notice: "${manifest.rights.notice}"`);
  return { id: 'notice:pages', category: 'notice', status: pages.length && !missing.length ? 'pass' : 'fail', title: 'Rights notice on every page', details };
}

/**
 * Serves the original and the protected build side by side and compares them: route status,
 * rendered text, screenshots per viewport, scripted flows, console/network/hydration errors,
 * accessibility smoke checks, load performance and the presence of the rights notice.
 */
export async function verifyBuilds(options: VerifyOptions): Promise<VerifyReport> {
  const { project, logger } = options;
  const cfg = project.config.verify;
  const started = performance.now();
  const baselineDir = options.baselineDir ?? project.inputDir;
  const protectedDir = options.protectedDir ?? project.outputDir;
  for (const [label, dir] of [
    ['baseline build', baselineDir],
    ['protected build', protectedDir],
  ] as const) {
    if (!(await pathExists(dir))) {
      throw new DcmError('E_VERIFY_MISSING', `${label} not found at ${path.relative(project.root, dir)}`, {
        hint: label === 'protected build' ? 'Run `dcm protect` first.' : 'Run your production build first.',
        exitCode: ExitCode.Config,
      });
    }
  }
  const artifactsDir = options.artifactsDir ?? path.join(project.dcmDir, 'verify');
  await fs.rm(artifactsDir, { recursive: true, force: true });
  await fs.mkdir(artifactsDir, { recursive: true });
  const ignore = cfg.ignoreConsole.map((p) => new RegExp(p));
  const checks: Check[] = [];

  const baseline = await startTarget(project, 'baseline', baselineDir);
  let protectedTarget: RunningTarget | undefined;
  let browser: Browser | undefined;
  try {
    protectedTarget = await startTarget(project, 'protected', protectedDir);
    browser = await chromium.launch({ headless: project.config.browser.headless, ...(project.config.browser.channel ? { channel: project.config.browser.channel } : {}) });
    const firstViewport = cfg.viewports[0] as Viewport;
    const routes = await discoverRoutes(browser, baseline, project, firstViewport);
    logger.step(`Verifying ${routes.length} route(s) × ${cfg.viewports.length} viewport(s)`);

    for (const viewport of cfg.viewports) {
      const baseCtx = await newStableContext(browser, viewport, project.config.browser);
      const protCtx = await newStableContext(browser, viewport, project.config.browser);
      try {
        for (const route of routes) {
          const opts = { timeoutMs: cfg.navigationTimeoutMs, ignoreConsole: ignore };
          let a: PageCapture;
          let b: PageCapture;
          try {
            a = await capturePage(baseCtx, new URL(route, baseline.url).toString(), opts);
            b = await capturePage(protCtx, new URL(route, protectedTarget.url).toString(), opts);
          } catch (error) {
            checks.push({
              id: `route:${viewport.name}:${route}`,
              category: 'route',
              status: 'fail',
              title: `${route} (${viewport.name}) could not be loaded`,
              details: [(error as Error).message.split('\n')[0] ?? 'navigation failed'],
            });
            continue;
          }
          const routeDetails: string[] = [];
          let routeOk = true;
          if (a.status !== b.status) {
            routeOk = false;
            routeDetails.push(`HTTP status differs: ${a.status} → ${b.status}`);
          }
          if (a.title !== b.title) {
            routeOk = false;
            routeDetails.push(`title differs: "${a.title}" → "${b.title}"`);
          }
          if (a.text !== b.text) {
            routeOk = false;
            const idx = [...a.text].findIndex((ch, i) => ch !== b.text[i]);
            routeDetails.push(`rendered text differs near: "${a.text.slice(Math.max(0, idx - 30), idx + 50)}" vs "${b.text.slice(Math.max(0, idx - 30), idx + 50)}"`);
          }
          checks.push({
            id: `route:${viewport.name}:${route}`,
            category: 'route',
            status: routeOk ? 'pass' : 'fail',
            title: `${route} (${viewport.name}) renders the same content`,
            details: routeOk ? [`status ${b.status}, ${b.text.length} characters of text`] : routeDetails,
          });

          const errors = [
            ...newIssues(a.diagnostics.pageErrors, b.diagnostics.pageErrors).map((m) => `uncaught: ${m}`),
            ...newIssues(a.diagnostics.consoleErrors, b.diagnostics.consoleErrors).map((m) => `console: ${m}`),
            ...newIssues(a.diagnostics.failedRequests, b.diagnostics.failedRequests).map((m) => `request failed: ${m}`),
            ...newIssues(a.diagnostics.httpErrors, b.diagnostics.httpErrors).map((m) => `HTTP: ${m}`),
            ...newIssues(a.diagnostics.hydrationErrors, b.diagnostics.hydrationErrors).map((m) => `hydration: ${m}`),
          ];
          checks.push({
            id: `console:${viewport.name}:${route}`,
            category: 'console',
            status: errors.length === 0 ? 'pass' : cfg.failOnConsoleError ? 'fail' : 'warn',
            title: `${route} (${viewport.name}) has no new runtime, network or hydration errors`,
            details: errors.length ? errors.slice(0, 10) : ['no errors introduced by protection'],
          });

          if (!options.skipVisual) {
            const cmp = comparePngs(a.screenshot, b.screenshot, cfg.pixelThreshold);
            const base = path.join(artifactsDir, viewport.name, slug(route));
            await fs.mkdir(path.dirname(base), { recursive: true });
            const artifacts: Record<string, string> = {
              baseline: `${base}-baseline.png`,
              protected: `${base}-protected.png`,
              diff: `${base}-diff.png`,
            };
            await fs.writeFile(artifacts.baseline as string, cropHeight(a.screenshot, 3000));
            await fs.writeFile(artifacts.protected as string, cropHeight(b.screenshot, 3000));
            await fs.writeFile(artifacts.diff as string, cropHeight(cmp.diffPng, 3000));
            const ok = cmp.sizeMatches && cmp.diffRatio <= cfg.screenshotTolerance;
            checks.push({
              id: `visual:${viewport.name}:${route}`,
              category: 'visual',
              status: ok ? 'pass' : 'fail',
              title: `${route} (${viewport.name}) looks identical`,
              details: [
                `${(cmp.diffRatio * 100).toFixed(3)}% pixels differ (tolerance ${(cfg.screenshotTolerance * 100).toFixed(3)}%)`,
                ...(cmp.sizeMatches ? [] : [`size differs: ${cmp.sizes.a.join('×')} → ${cmp.sizes.b.join('×')}`]),
              ],
              artifacts: Object.fromEntries(Object.entries(artifacts).map(([k, v]) => [k, path.relative(project.root, v)])),
            });
          }

          const regressions = a11yRegressions(a.a11y, b.a11y);
          checks.push({
            id: `a11y:${viewport.name}:${route}`,
            category: 'a11y',
            status: regressions.length ? 'fail' : 'pass',
            title: `${route} (${viewport.name}) accessibility smoke checks unchanged`,
            details: regressions.length
              ? regressions
              : [
                  `lang ${b.a11y.missingLang ? 'missing' : 'ok'}, title ${b.a11y.missingTitle ? 'missing' : 'ok'}, unnamed buttons ${b.a11y.unnamedButtons}, unlabeled inputs ${b.a11y.unlabeledInputs}, images without alt ${b.a11y.imagesWithoutAlt}`,
                ],
          });
        }
      } finally {
        await baseCtx.close();
        await protCtx.close();
      }
    }

    // Scripted flows run on the first viewport for both builds.
    for (const flow of cfg.flows) {
      const baseCtx = await newStableContext(browser, firstViewport, project.config.browser);
      const protCtx = await newStableContext(browser, firstViewport, project.config.browser);
      let a: FlowResult;
      let b: FlowResult;
      try {
        a = await runFlow(baseCtx, baseline.url, flow, cfg.navigationTimeoutMs, ignore);
        b = await runFlow(protCtx, protectedTarget.url, flow, cfg.navigationTimeoutMs, ignore);
      } finally {
        await baseCtx.close();
        await protCtx.close();
      }
      if (!a.ok) {
        checks.push({
          id: `flow:${flow.name}`,
          category: 'flow',
          status: 'warn',
          title: `Flow "${flow.name}" fails on the baseline too`,
          details: [`baseline failed at: ${a.steps.find((s) => !s.ok)?.step ?? '?'} (${a.steps.find((s) => !s.ok)?.error ?? ''})`, 'fix the flow definition in dcm.config.ts'],
        });
        continue;
      }
      const details = b.steps.map((s) => `${s.ok ? '✔' : '✖'} ${s.step}${s.error ? ` — ${s.error}` : ''}`);
      const sameEnd = a.finalText === b.finalText;
      if (!sameEnd) details.push('final page text differs from baseline');
      checks.push({
        id: `flow:${flow.name}`,
        category: 'flow',
        status: b.ok && sameEnd ? 'pass' : 'fail',
        title: `Flow "${flow.name}" behaves identically`,
        details,
      });
    }

    let performanceResult: VerifyReport['performance'];
    if (!options.skipPerformance) {
      const runs = cfg.performanceRuns;
      logger.step(`Measuring load performance (${runs} cold load(s) per build)`);
      const basePerf = await measureLoads(browser, baseline.url, runs, project.config.browser);
      const protPerf = await measureLoads(browser, protectedTarget.url, runs, project.config.browser);
      performanceResult = { baseline: basePerf, protected: protPerf };
      const budgets = project.config.budgets;
      const compare = (label: string, before: number | null, after: number | null, budgetPct: number, floorMs: number): void => {
        if (before === null || after === null) {
          checks.push({ id: `perf:${label}`, category: 'performance', status: 'skip', title: `${label} budget`, details: ['metric unavailable in this browser'] });
          return;
        }
        const pct = pctChange(before, after);
        // Small absolute deltas on loopback are noise; require both a relative and an absolute regression.
        const exceeded = pct !== null && pct > budgetPct && after - before > floorMs;
        checks.push({
          id: `perf:${label}`,
          category: 'performance',
          status: exceeded ? 'fail' : 'pass',
          title: `${label} within budget (+${budgetPct}%)`,
          details: [`median ${before.toFixed(1)} ms → ${after.toFixed(1)} ms (${pct === null ? 'n/a' : `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`})`],
        });
      };
      compare('load time', basePerf.median.loadMs, protPerf.median.loadMs, budgets.maxLoadTimeIncreasePct, 50);
      compare('script execution time', basePerf.median.scriptDurationMs, protPerf.median.scriptDurationMs, budgets.maxScriptDurationIncreasePct, 25);
    }

    checks.push(await noticeCheck(protectedDir, options.protectManifest));

    const summary = { pass: 0, fail: 0, warn: 0, skip: 0 } as Record<CheckStatus, number>;
    for (const c of checks) summary[c.status]++;
    const budgetExceeded = checks.some((c) => c.category === 'performance' && c.status === 'fail');
    const functionalFail = checks.some((c) => c.status === 'fail' && c.category !== 'performance');
    return {
      tool: 'dont-copy-me',
      kind: 'verify',
      createdAt: nowIso(),
      ok: !functionalFail && !budgetExceeded,
      budgetExceeded,
      baseline: path.relative(project.root, baselineDir),
      protected: path.relative(project.root, protectedDir),
      routes,
      viewports: cfg.viewports.map((v) => `${v.name} ${v.width}×${v.height}`),
      checks,
      ...(performanceResult ? { performance: performanceResult } : {}),
      summary,
      durationMs: Math.round(performance.now() - started),
    };
  } finally {
    await browser?.close();
    await protectedTarget?.close();
    await baseline.close();
  }
}
