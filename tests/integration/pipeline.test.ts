import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { pathExists, rollbackOutput } from '@dont-copy-me/core';
import { codeBanner, injectRights, pagePath, protectBuild, renderNotice, RIGHTS_ATTR } from '@dont-copy-me/notice';
import { defaultConfig } from '@dont-copy-me/core';
import { APP_JS, RIGHTS, logger, makeProject, tempDir, treeHash, writeTree } from '../helpers.js';

async function viteFixture(extra: Record<string, string> = {}): Promise<string> {
  const root = await tempDir();
  await writeTree(root, {
    'package.json': JSON.stringify({ name: 'fixture', devDependencies: { vite: '^8.0.0' } }),
    'vite.config.ts': 'export default {}',
    'src/main.ts': 'console.log("source must never change")',
    'dist/index.html':
      '<!doctype html><html><head><title>Lumen</title><script type="module" crossorigin src="/assets/index-aaa111.js" integrity="sha384-OLD"></script><link rel="stylesheet" href="/assets/index-ccc.css"></head><body><div id="root"></div></body></html>',
    'dist/pricing/index.html': '<!doctype html><html><head><title>Pricing</title></head><body><main>Plans</main></body></html>',
    'dist/assets/index-aaa111.js': APP_JS,
    'dist/assets/index-aaa111.js.map': JSON.stringify({ version: 3, sources: ['../../src/main.ts'], mappings: 'AAAA', names: [] }),
    'dist/assets/index-ccc.css': 'body{margin:0}\n',
    ...extra,
  });
  return root;
}

const rights = { ...defaultConfig().rights, ...RIGHTS };

describe('rights notice rendering', () => {
  it('substitutes year, owner and contact, and states that no license is granted', () => {
    const { text, codeBanner: banner } = renderNotice(rights, 2026);
    expect(text).toMatch(/^© 2026 Lumen Analytics\. All rights reserved\./);
    expect(text).toContain('Lumen Analytics has not licensed');
    expect(text).toContain('including with automated or AI tools');
    expect(text).toMatch(/Permission requests: legal@lumen\.example\.$/);
    expect(banner).toContain('Original site: https://lumen.example');
    expect(banner).toContain('Third-party components included here remain under their own licenses.');
  });

  it('drops the contact sentence when no contact is configured', () => {
    const { text } = renderNotice({ ...rights, contact: undefined, instructionIsNotPermission: false, permissionRegistry: false, keepNotice: false, notice: '© {year} {owner}. Ask us at {contact}. Thanks.' }, 2026);
    expect(text).toBe('© 2026 Lumen Analytics. Thanks.');
  });

  it('adds visible, metadata and source-comment copies of the same text, and nothing hidden from the page', () => {
    const html = injectRights('<!doctype html><html><head></head><body><p>Hi</p></body></html>', rights, { year: 2026, file: 'pricing/index.html' });
    const { text } = renderNotice(rights, 2026);
    expect(html).toMatch(/^<!doctype html>\n<!-- © 2026 Lumen Analytics/);
    expect(html).toContain('<meta name="copyright" content="© 2026 Lumen Analytics">');
    expect(html).toContain('<meta name="tdm-reservation" content="1">');
    expect(html).toContain('<meta name="robots" content="noai, noimageai">');
    expect(html).toContain('<link rel="canonical" href="https://lumen.example/pricing/">');
    const ld = JSON.parse(/<script type="application\/ld\+json"[^>]*>([^<]+)<\/script>/.exec(html)?.[1] ?? '{}') as Record<string, unknown>;
    expect(ld.copyrightNotice).toBe(text);
    expect(ld.license).toBe('https://lumen.example/terms');
    expect(html).toContain(`<p ${RIGHTS_ATTR}`);
    expect(html).toContain('<a href="mailto:legal@lumen.example">Request permission</a>');
    // The visible footer must not be hidden.
    expect(/<p data-dcm-rights[^>]*style="[^"]*(display:\s*none|visibility:\s*hidden|font-size:\s*0)/.test(html)).toBe(false);
    expect(injectRights(html, rights)).toBe(html);
  });

  it('keeps an existing canonical link and escapes JSON-LD', () => {
    const html = injectRights('<html><head><link rel="canonical" href="https://x.test/"></head><body></body></html>', { ...rights, owner: '</script><b>' }, { file: 'index.html' });
    expect(html.match(/rel="canonical"/g)).toHaveLength(1);
    expect(html).not.toContain('</script><b>');
  });

  it('builds safe code banners and page paths', () => {
    expect(codeBanner({ ...rights, notice: 'evil */ alert(1) /*' })).not.toMatch(/\*\/ alert/);
    expect(pagePath('index.html')).toBe('/');
    expect(pagePath('pricing/index.html')).toBe('/pricing/');
    expect(pagePath('about.html')).toBe('/about');
  });
});

describe('protectBuild', () => {
  it('writes a separate output with the notice and never modifies the input or sources', async () => {
    const root = await viteFixture();
    const before = await treeHash(path.join(root, 'dist'));
    const srcBefore = await treeHash(path.join(root, 'src'));
    const project = await makeProject(root, { framework: 'vite', rights: RIGHTS });
    const manifest = await protectBuild({ project, logger: logger() });

    expect(await treeHash(path.join(root, 'dist'))).toBe(before);
    expect(await treeHash(path.join(root, 'src'))).toBe(srcBefore);
    expect(manifest.rights).toMatchObject({ html: 2, css: 1, js: 1, sourceMapsShifted: 1, tdmrep: true, owner: 'Lumen Analytics' });
    const out = (f: string): Promise<string> => fs.readFile(path.join(root, 'dist-protected', f), 'utf8');
    expect(await out('pricing/index.html')).toContain(RIGHTS_ATTR);
    expect(await out('assets/index-ccc.css')).toMatch(/^\/\*! © \d{4} Lumen Analytics/);
    expect(await out('assets/index-aaa111.js')).toMatch(/^\/\*! © \d{4} Lumen Analytics[^\n]*\*\/\nexport function quote/);
    // Source map shifted by the one banner line.
    expect(JSON.parse(await out('assets/index-aaa111.js.map')).mappings).toBe(';AAAA');
    expect(JSON.parse(await out('.well-known/tdmrep.json'))).toEqual([{ location: '/', 'tdm-reservation': 1, 'tdm-policy': 'https://lumen.example/terms' }]);
    // SRI recomputed for the bannered entry script.
    expect(await out('index.html')).not.toContain('sha384-OLD');
    expect(manifest.integrityUpdates).toBe(1);
    // The only warning on a first run: the signing key was just created.
    expect(manifest.warnings).toEqual([expect.stringMatching(/^Created the permission signing key/)]);
  });

  it('is idempotent and deterministic for the same input', async () => {
    const root = await viteFixture();
    const project = await makeProject(root, { framework: 'vite', rights: RIGHTS });
    const a = await protectBuild({ project, logger: logger() });
    const b = await protectBuild({ project, logger: logger() });
    expect(b.outputFingerprint).toBe(a.outputFingerprint);
  });

  it('respects switches for each copy of the notice', async () => {
    const root = await viteFixture();
    const project = await makeProject(root, { framework: 'vite', rights: { ...RIGHTS, visible: false, sourceBanners: false, structuredData: false, noAiMeta: false, tdmReservation: false } });
    const manifest = await protectBuild({ project, logger: logger() });
    expect(manifest.rights).toMatchObject({ css: 0, js: 0, tdmrep: false });
    const html = await fs.readFile(path.join(root, 'dist-protected/index.html'), 'utf8');
    expect(html).toContain('<meta name="copyright"');
    expect(html).not.toContain('<p data-dcm-rights');
    expect(html).not.toContain('application/ld+json');
    expect(html).not.toContain('noai');
    expect(await pathExists(path.join(root, 'dist-protected/.well-known/tdmrep.json'))).toBe(false);
  });

  it('warns when the owner or a permission channel is missing, and refuses when disabled', async () => {
    const root = await viteFixture();
    const warn = await protectBuild({ project: await makeProject(root, { framework: 'vite' }), logger: logger(), dryRun: true });
    expect(warn.warnings.join(' ')).toMatch(/rights\.owner is not set/);
    expect(warn.warnings.join(' ')).toMatch(/no way to ask for permission/);
    const off = await makeProject(root, { framework: 'vite', rights: { enabled: false } });
    await expect(protectBuild({ project: off, logger: logger() })).rejects.toMatchObject({ code: 'E_RIGHTS_DISABLED' });
  });

  it('dry-run reports counts without writing anything', async () => {
    const root = await viteFixture();
    const project = await makeProject(root, { framework: 'vite', rights: RIGHTS });
    const manifest = await protectBuild({ project, logger: logger(), dryRun: true });
    expect(manifest.dryRun).toBe(true);
    expect(manifest.rights.html).toBe(2);
    expect(await pathExists(path.join(root, 'dist-protected'))).toBe(false);
    expect(await pathExists(path.join(root, '.dcm'))).toBe(false);
  });

  it('keeps backups and rolls back to the previous output', async () => {
    const root = await viteFixture();
    const project = await makeProject(root, { framework: 'vite', rights: RIGHTS });
    await protectBuild({ project, logger: logger() });
    const first = await treeHash(path.join(root, 'dist-protected'));
    const other = await makeProject(root, { framework: 'vite', rights: { ...RIGHTS, owner: 'Other Owner' } });
    const second = await protectBuild({ project: other, logger: logger() });
    expect(second.backup).toMatch(/\.dcm\/backups\/dist-protected-/);
    expect(await treeHash(path.join(root, 'dist-protected'))).not.toBe(first);
    const result = await rollbackOutput(project.outputDir, project.backupsDir);
    expect(await treeHash(path.join(root, 'dist-protected'))).toBe(first);
    expect(result.preserved).toBeDefined();
  });

  it('fails without publishing when a referenced script is missing', async () => {
    const root = await viteFixture({ 'dist/broken.html': '<html><head><script src="/assets/missing.js"></script></head><body></body></html>' });
    const project = await makeProject(root, { framework: 'vite', rights: RIGHTS });
    await expect(protectBuild({ project, logger: logger() })).rejects.toMatchObject({ code: 'E_BROKEN_REFERENCES' });
    expect(await pathExists(path.join(root, 'dist-protected'))).toBe(false);
  });

  it('reports a missing build with an actionable hint', async () => {
    const root = await tempDir();
    await writeTree(root, { 'package.json': '{"devDependencies":{"vite":"8"}}' });
    const project = await makeProject(root, { framework: 'vite', rights: RIGHTS });
    await expect(protectBuild({ project, logger: logger() })).rejects.toMatchObject({ code: 'E_NO_BUILD', hint: expect.stringMatching(/build/) });
  });
});
