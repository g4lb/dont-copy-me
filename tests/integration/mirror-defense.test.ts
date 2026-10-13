import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '@dont-copy-me/core';
import { allowedHosts, copyCheckScript, injectRights, MIRROR_AGENTS, mirrorRobotsBlock, protectBuild } from '@dont-copy-me/notice';
import { RIGHTS, logger, makeProject, tempDir, writeTree } from '../helpers.js';

const rights = { ...defaultConfig().rights, ...RIGHTS };

/** Runs the copy-check script against a fake page on `host` and reports whether the bar appeared. */
function barShownOn(host: string, extra: string[] = []): boolean {
  const added: Array<{ id: string; textContent: string }> = [];
  const el = (): Record<string, unknown> => ({ style: {}, setAttribute() {}, appendChild() {}, textContent: '' });
  const document = {
    body: { appendChild: (n: { id: string; textContent: string }) => added.push(n) },
    getElementById: () => null,
    createElement: el,
    addEventListener() {},
  };
  vm.runInNewContext(copyCheckScript({ ...rights, allowedHosts: extra }, 2026), { location: { hostname: host }, document });
  return added.some((n) => n.id === 'dcm-copy-notice');
}

describe('site-mirroring tools', () => {
  it('robots.txt block names mirroring tools only, never search engines', () => {
    const block = mirrorRobotsBlock();
    expect(block).toContain('User-agent: Wget\nUser-agent: HTTrack');
    expect(block).toMatch(/Disallow: \/\n$/);
    expect(block).not.toMatch(/User-agent: \*|Googlebot|Bingbot/i);
    expect(MIRROR_AGENTS).toContain('HTTrack');
  });

  it('creates robots.txt, appends to an existing one once, and keeps its rules', async () => {
    const root = await tempDir();
    await writeTree(root, { 'dist/index.html': '<!doctype html><html><head></head><body></body></html>', 'dist/robots.txt': 'User-agent: *\nDisallow: /admin\n' });
    const project = await makeProject(root, { framework: 'static', rights: RIGHTS });
    const m = await protectBuild({ project, logger: logger() });
    expect(m.rights.robots).toBe('appended');
    const robots = await fs.readFile(path.join(root, 'dist-protected/robots.txt'), 'utf8');
    expect(robots.startsWith('User-agent: *\nDisallow: /admin\n')).toBe(true);
    expect(robots.match(/site-mirroring tools/gi)).toHaveLength(1);
    expect(await fs.readFile(path.join(root, 'dist/robots.txt'), 'utf8')).toBe('User-agent: *\nDisallow: /admin\n');

    const fresh = await tempDir();
    await writeTree(fresh, { 'dist/index.html': '<!doctype html><html><head></head><body></body></html>' });
    expect((await protectBuild({ project: await makeProject(fresh, { framework: 'static', rights: RIGHTS }), logger: logger() })).rights.robots).toBe('created');
  });
});

describe('copy label', () => {
  it('shows on foreign hosts and file copies, not on the original, localhost or allowed hosts', () => {
    expect(barShownOn('copycat-site.test')).toBe(true);
    expect(barShownOn('')).toBe(true);
    expect(barShownOn('lumen.example')).toBe(false);
    expect(barShownOn('www.lumen.example')).toBe(false);
    expect(barShownOn('localhost')).toBe(false);
    expect(barShownOn('127.0.0.1')).toBe(false);
    expect(barShownOn('preview-123.vercel.app', ['*.vercel.app'])).toBe(false);
    expect(barShownOn('vercel.app.evil.test', ['*.vercel.app'])).toBe(true);
    expect(allowedHosts(rights)).toEqual(['lumen.example', 'www.lumen.example', 'localhost', '127.0.0.1', '::1', '[::1]']);
  });

  it('is a plain script referenced from every page, and only with siteUrl', async () => {
    expect(copyCheckScript(rights, 2026)).toContain('"This is a copy of https://lumen.example. Lumen Analytics has not licensed it."');
    expect(injectRights('<html><head></head><body></body></html>', rights)).toContain('<script src="/.well-known/dcm-copy-check.js" defer data-dcm-copy-check></script>');
    expect(injectRights('<html><head></head><body></body></html>', { ...rights, siteUrl: undefined })).not.toContain('dcm-copy-check');
    const root = await tempDir();
    await writeTree(root, { 'dist/index.html': '<!doctype html><html><head></head><body></body></html>' });
    const m = await protectBuild({ project: await makeProject(root, { framework: 'static', rights: RIGHTS }), logger: logger() });
    expect(m.rights.copyBanner).toBe(true);
    expect(await fs.readFile(path.join(root, 'dist-protected/.well-known/dcm-copy-check.js'), 'utf8')).toMatch(/^\/\*! © /);
  });
});
