import fs from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { copyDir, type DcmConfigInput, type ProjectContext } from '@dont-copy-me/core';
import { protectBuild } from '@dont-copy-me/notice';
import { verifyBuilds } from '@dont-copy-me/verify';
import { createRunners, runCloneBenchmark, selectRunners } from '@dont-copy-me/benchmark';
import { RIGHTS, logger, makeProject, tempDir } from '../helpers.js';

const FIXTURE = path.resolve(import.meta.dirname, '../fixtures/static-app');
const MOCK_AGENT = path.resolve(import.meta.dirname, '../fixtures/mock-agent.mjs');

const flows: DcmConfigInput['verify'] = {
  routes: ['/', '/about.html'],
  crawl: true,
  performanceRuns: 1,
  flows: [
    {
      name: 'pricing',
      path: '/',
      steps: [
        { action: 'click', selector: '#more' },
        { action: 'click', selector: '#yearly' },
        { action: 'expectText', selector: '#total', text: '/yr' },
        { action: 'expectText', selector: '#seats', text: '11' },
      ],
    },
    {
      name: 'contact validation',
      path: '/',
      steps: [
        { action: 'fill', selector: '#email', value: 'nope' },
        { action: 'click', selector: 'button[type=submit]' },
        { action: 'expectText', selector: '#status', text: 'valid email' },
      ],
    },
  ],
};

async function fixtureProject(extra: Partial<DcmConfigInput> = {}): Promise<ProjectContext> {
  const root = await tempDir('dcm-e2e-');
  await copyDir(FIXTURE, path.join(root, 'dist'));
  await fs.writeFile(path.join(root, 'package.json'), '{"name":"fixture"}');
  return makeProject(root, { framework: 'static', rights: RIGHTS, verify: flows, ...extra });
}

describe('protect → verify in a real browser', () => {
  let project: ProjectContext;
  beforeAll(async () => {
    project = await fixtureProject();
    const manifest = await protectBuild({ project, logger: logger() });
    expect(manifest.rights).toMatchObject({ html: 2, js: 2, css: 1 });
  });

  it('passes notice, visual, functional, console, a11y and budget checks for a correct output', async () => {
    const report = await verifyBuilds({ project, logger: logger() });
    const failed = report.checks.filter((c) => c.status === 'fail');
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.routes.sort()).toEqual(['/', '/about.html']);
    expect(report.checks.filter((c) => c.category === 'flow' && c.status === 'pass')).toHaveLength(2);
    expect(report.checks.some((c) => c.category === 'visual')).toBe(true);
    expect(report.checks.find((c) => c.id === 'notice:pages')?.status).toBe('pass');
    expect(report.performance?.protected.median.loadMs).toBeGreaterThan(0);
  });

  it('fails when a page lost its notice', async () => {
    const broken = await fixtureProject();
    await protectBuild({ project: broken, logger: logger() });
    const about = path.join(broken.outputDir, 'about.html');
    await fs.writeFile(about, (await fs.readFile(about, 'utf8')).replace(/data-dcm-rights/g, 'data-x'));
    const report = await verifyBuilds({ project: broken, logger: logger(), skipPerformance: true, skipVisual: true });
    expect(report.checks.find((c) => c.id === 'notice:pages')?.status).toBe('fail');
    expect(report.ok).toBe(false);
  });

  it('fails when the output behaves differently', async () => {
    const broken = await fixtureProject();
    await protectBuild({ project: broken, logger: logger() });
    const file = path.join(broken.outputDir, 'assets/app.js');
    await fs.appendFile(file, '\ndocument.getElementById("more").remove();\n');
    const report = await verifyBuilds({ project: broken, logger: logger(), skipPerformance: true });
    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.id === 'flow:pricing')?.status).toBe('fail');
    // the missing button is caught by the rendered-content comparison
    expect(report.checks.find((c) => c.id === 'route:desktop:/')?.status).toBe('fail');
  });

  it('fails the visual check when styling changes', async () => {
    const broken = await fixtureProject();
    await protectBuild({ project: broken, logger: logger() });
    await fs.appendFile(path.join(broken.outputDir, 'assets/app.js'), '\ndocument.body.style.color = "rgb(200, 30, 30)";\n');
    const report = await verifyBuilds({ project: broken, logger: logger(), skipPerformance: true });
    expect(report.checks.find((c) => c.id === 'visual:desktop:/')?.status).toBe('fail');
    // text content is unchanged, so only the visual layer catches this
    expect(report.checks.find((c) => c.id === 'route:desktop:/')?.status).toBe('pass');
  });

  it('detects runtime errors in the output', async () => {
    const broken = await fixtureProject();
    await protectBuild({ project: broken, logger: logger() });
    await fs.appendFile(path.join(broken.outputDir, 'assets/app.js'), '\nsetTimeout(() => { throw new Error("boom from output"); }, 0);\n');
    const report = await verifyBuilds({ project: broken, logger: logger(), skipPerformance: true, skipVisual: true });
    const consoleCheck = report.checks.find((c) => c.category === 'console' && c.status === 'fail');
    expect(consoleCheck?.details.join()).toContain('boom from output');
  });
});

describe('clone benchmark harness with a mock agent provider', () => {
  it('runs scenarios A–D, parses usage, evaluates clones and reports mirroring honestly', async () => {
    const project = await fixtureProject({
      benchmark: {
        clone: {
          routes: ['/'],
          flows: [
            { name: 'yearly toggle', path: '/', steps: [{ action: 'click', selector: 'button:has-text("Yearly")' }, { action: 'expectText', selector: 'body', text: '/yr' }] },
          ],
          command: { command: process.execPath, args: [MOCK_AGENT, '{url}', '{out}'], usageParser: 'claude-json' },
        },
      },
      verify: { ...flows, viewports: [{ name: 'desktop', width: 1024, height: 700 }] },
    });
    await protectBuild({ project, logger: logger() });
    const runners = selectRunners(createRunners(project.config), ['mirror', 'command', 'copycat']);
    const report = await runCloneBenchmark({ project, logger: logger(), runners, trials: 1, timeoutMs: 60_000, allowAi: true, sites: { baseline: project.inputDir, protected: project.outputDir } });

    const mirror = report.runners.find((r) => r.id === 'mirror')!;
    expect(mirror.trials.map((t) => t.scenario).sort()).toEqual(['A', 'B']);
    expect(mirror.aggregate?.protected.reusesOriginalJsRate).toBe(1);
    expect(mirror.aggregate?.protected.functionalPassRate.mean).toBe(1);

    expect(report.findings.find((f) => f.runner === 'mirror' && f.verdict === 'protection-failed')).toBeDefined();
    expect(mirror.aggregate?.protected.copyLabelRate).toBe(1);
    expect(mirror.aggregate?.baseline.copyLabelRate).toBe(0);
    expect(report.findings.find((f) => f.runner === 'mirror' && f.metric === 'mirrored copy labels itself')?.verdict).toBe('protection-effective');

    const agent = report.runners.find((r) => r.id === 'command')!;
    expect(agent.executed).toBe(true);
    expect(agent.trials.map((t) => t.scenario).sort()).toEqual(['C', 'D']);
    for (const t of agent.trials) {
      expect(t.attempt.status).toBe('completed');
      expect(t.attempt.usage?.toolCalls).toBe(5);
      expect(t.attempt.usage?.totalTokens).toBe(150);
      expect(t.evaluation?.visual?.meanSimilarity).toBeGreaterThan(0.99);
      expect(t.evaluation?.offline?.independent).toBe(true);
      expect(t.server.requests).toBeGreaterThanOrEqual(5);
    }
    // single trial per side → verdicts must not claim an effect
    expect(report.findings.filter((f) => f.runner === 'command').every((f) => f.verdict === 'inconclusive')).toBe(true);
    // the mock agent copies the pages verbatim, so its clone of the site with the notice keeps it
    expect(agent.aggregate?.protected.noticeRetainedRate).toBe(1);
    expect(agent.aggregate?.baseline.noticeRetainedRate).toBeNull();

    const cw = report.runners.find((r) => r.id === 'copycat')!;
    expect(cw.executed).toBe(false);
    expect(report.findings.find((f) => f.runner === 'copycat')?.verdict).toBe('not-executed');
  });

  it('skips AI runners unless token spend was confirmed', async () => {
    const project = await fixtureProject({ benchmark: { clone: { command: { command: process.execPath, args: [MOCK_AGENT, '{url}', '{out}'], usageParser: 'none' } } } });
    await protectBuild({ project, logger: logger() });
    const report = await runCloneBenchmark({
      project,
      logger: logger(),
      runners: selectRunners(createRunners(project.config), ['command']),
      trials: 1,
      timeoutMs: 30_000,
      allowAi: false,
      sites: { baseline: project.inputDir, protected: project.outputDir },
    });
    expect(report.runners[0]?.executed).toBe(false);
    expect(report.runners[0]?.skipReason).toMatch(/--yes/);
  });
});
