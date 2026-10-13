import { describe, expect, it } from 'vitest';
import { defaultConfig } from '@dont-copy-me/core';
import { recommendations, renderHtml, renderMarkdown, type ReportModel } from '@dont-copy-me/reporter';
import { AI_CRAWLERS, cloudflareRules, generateShieldFiles, robotsTxt, shieldOptionsFromConfig, tdmOptionsFromConfig } from '@dont-copy-me/shield';

function model(overrides: Partial<ReportModel> = {}): ReportModel {
  return { generatedAt: '2026-01-01T00:00:00.000Z', projectRoot: '/proj', history: [], ...overrides };
}

const cloneReport = {
  tool: 'dont-copy-me',
  kind: 'benchmark-clone',
  runId: 'run-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  durationMs: 1,
  environment: { platform: 'darwin', release: '1', cpu: 'cpu', cpus: 8, memoryGb: 16, node: 'v22', chromium: '156' },
  settings: { trials: 1, timeoutMs: 60000, model: null, maxBudgetUsd: null, prompt: 'p', routes: ['/'], viewports: ['desktop'], flows: [], isolation: 'sandbox', sites: { baseline: 'b', protected: 'p' } },
  runners: [
    { id: 'copycat', title: 'Copycat <script>', technique: 'ai-reconstruction', requiresAi: true, availability: { available: false, reason: 'copycat not configured' }, executed: false, skipReason: 'copycat not configured', trials: [] },
  ],
  findings: [{ runner: 'copycat', technique: 'ai-reconstruction', verdict: 'not-executed', metric: '-', summary: 'copycat not configured' }],
  limitations: ['loopback only'],
} as unknown as NonNullable<ReportModel['clone']>;

describe('report generation', () => {
  it('always states the limits and never invents results', () => {
    const md = renderMarkdown(model());
    expect(md).toContain('cannot be made uncopyable');
    expect(md).toContain('| Clone benchmark | not run |');
    expect(md).toContain('| Verify | not run |');
  });

  it('marks unexecuted runners as not executed and recommends running them', () => {
    const md = renderMarkdown(model({ clone: cloneReport }));
    expect(md).toContain('**Not executed:** copycat not configured');
    expect(md).toContain('**not-executed**');
    expect(md).not.toMatch(/Visual similarity \| \d/);
    expect(recommendations(model({ clone: cloneReport })).some((r) => r.title === 'Run the AI clone benchmark')).toBe(true);
  });

  it('escapes HTML and produces a self-contained page with dark-mode tokens', () => {
    const html = renderHtml(model({ clone: cloneReport }), '/proj/.dcm/report.html');
    expect(html).toContain('Copycat &lt;script&gt;');
    expect(html).not.toContain('Copycat <script>');
    expect(html).toContain('prefers-color-scheme:dark');
    expect(html).not.toMatch(/<script\b/);
    // no external resources: the dashboard works offline
    expect(html).not.toMatch(/<link[^>]+href="https?:/);
  });
});

describe('shield templates', () => {
  it('blocks training crawlers by default and keeps search engines and assistants', () => {
    const options = shieldOptionsFromConfig(defaultConfig().waf);
    const robots = robotsTxt(options);
    expect(robots).toContain('User-agent: GPTBot\nDisallow: /');
    expect(robots).toContain('User-agent: CCBot');
    expect(robots).not.toContain('User-agent: OAI-SearchBot');
    expect(robots).not.toContain('User-agent: ChatGPT-User');
    expect(robots).not.toContain('Googlebot');
    expect(robots).toContain('ADVISORY');
    expect(robots.trim().endsWith('Allow: /')).toBe(true);
  });

  it('produces Cloudflare rules that only block declared crawlers', () => {
    const rules = cloudflareRules(shieldOptionsFromConfig(defaultConfig().waf)) as Record<string, { rules: Array<{ expression: string; action: string }> }>;
    expect(Object.keys(rules)).toEqual(['custom_rules']);
    expect(rules.custom_rules?.rules[0]?.expression).toContain('(http.user_agent contains "GPTBot")');
    expect(rules.custom_rules?.rules.every((r) => r.action === 'block')).toBe(true);
    expect(AI_CRAWLERS.every((c) => !/[\s"]/.test(c.token))).toBe(true);
  });

  it('documents its limits alongside the templates', () => {
    const files = generateShieldFiles(shieldOptionsFromConfig(defaultConfig().waf));
    expect(files.map((f) => f.name)).toEqual(['robots.txt', 'cloudflare-rules.json', 'nginx-ai-crawlers.conf', 'README.md']);
    expect(files.find((f) => f.name === 'README.md')?.content).toMatch(/not access control/);
  });

  it('adds TDMRep headers only when the rights notice reserves TDM', () => {
    const waf = shieldOptionsFromConfig(defaultConfig().waf);
    expect(tdmOptionsFromConfig({ ...defaultConfig().rights, enabled: false })).toBeUndefined();
    expect(tdmOptionsFromConfig(defaultConfig().rights)).toEqual({});
    const rights = { ...defaultConfig().rights, enabled: true, termsUrl: 'https://lumen.example/terms' };
    const files = generateShieldFiles(waf, tdmOptionsFromConfig(rights));
    const tdm = files.find((f) => f.name === 'tdm-headers.txt')?.content ?? '';
    expect(tdm).toContain('/*\n  tdm-reservation: 1\n  tdm-policy: https://lumen.example/terms');
    expect(tdm).toContain('# add_header tdm-reservation "1" always;');
    expect(tdm).toContain('"key": "tdm-policy"');
    expect(tdm).toMatch(/not access control/);
    expect(tdmOptionsFromConfig({ ...rights, tdmReservation: false })).toBeUndefined();
  });
});
