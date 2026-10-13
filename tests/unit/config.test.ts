import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig, loadConfig, parseConfig, resolveInside, assertSafeOutput, DcmError } from '@dont-copy-me/core';
import { tempDir, writeTree } from '../helpers.js';

describe('configuration validation', () => {
  it('provides safe defaults', () => {
    const c = defaultConfig();
    expect(c.framework).toBe('auto');
    expect(c.rights.enabled).toBe(true);
    expect(c.rights.visible && c.rights.sourceBanners && c.rights.structuredData && c.rights.tdmReservation).toBe(true);
    expect(c.rights.notice).toMatch(/including with automated or AI tools/);
    expect(c.waf.enabled).toBe(false);
    expect(c.verify.viewports.map((v) => v.name)).toEqual(['desktop', 'mobile']);
    expect(c.benchmark.clone.isolation).toBe('sandbox');
  });

  it('rejects unknown keys, bad enums and bad URLs with readable paths', () => {
    const r = parseConfig({ framework: 'insane', unknownKey: 1, rights: { termsUrl: 'not a url' }, verify: { routes: ['no-slash'] } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const paths = r.issues.map((i) => i.path);
    expect(paths).toContain('framework');
    expect(paths).toContain('rights.termsUrl');
    expect(paths).toContain('verify.routes.0');
    expect(r.issues.some((i) => /unknownKey|Unrecognized/i.test(i.message))).toBe(true);
  });

  it('validates flow steps as a discriminated union', () => {
    expect(parseConfig({ verify: { flows: [{ name: 'x', steps: [{ action: 'click' }] }] } }).ok).toBe(false);
    expect(parseConfig({ verify: { flows: [{ name: 'x', steps: [{ action: 'fill', selector: '#a', value: 'b' }] }] } }).ok).toBe(true);
  });

  it('rejects the removed obfuscation and fingerprint options', () => {
    expect(parseConfig({ profile: 'balanced' }).ok).toBe(false);
    expect(parseConfig({ fingerprint: { enabled: true } }).ok).toBe(false);
  });

  it('loads dcm.config.json and reports invalid files with the file name', async () => {
    const dir = await tempDir();
    await writeTree(dir, { 'dcm.config.json': JSON.stringify({ rights: { owner: 'Acme Ltd' } }) });
    const loaded = await loadConfig(dir);
    expect(loaded.config.rights.owner).toBe('Acme Ltd');
    expect(loaded.file).toBe(path.join(dir, 'dcm.config.json'));

    const bad = await tempDir();
    await writeTree(bad, { 'dcm.config.json': JSON.stringify({ rights: { owner: 7 } }) });
    await expect(loadConfig(bad)).rejects.toThrow(/Invalid configuration in dcm.config.json/);
  });

  it('loads a TypeScript config through jiti', async () => {
    const dir = await tempDir();
    await writeTree(dir, { 'dcm.config.ts': "const owner: string = 'Acme Ltd';\nexport default { rights: { owner, visible: false } };\n" });
    const loaded = await loadConfig(dir);
    expect(loaded.config.rights.owner).toBe('Acme Ltd');
    expect(loaded.config.rights.visible).toBe(false);
  });
});

describe('filesystem path safety', () => {
  it('prevents path traversal outside the project', () => {
    expect(() => resolveInside('/tmp/project', '../etc', 'output')).toThrow(DcmError);
    expect(() => resolveInside('/tmp/project', '/etc/passwd', 'output')).toThrow(/outside the project/);
    expect(resolveInside('/tmp/project', 'dist-protected', 'output')).toBe('/tmp/project/dist-protected');
  });

  it('refuses outputs that overlap the input or hit source directories', () => {
    expect(() => assertSafeOutput('/p', '/p/dist', '/p/dist')).toThrow(/overlaps/);
    expect(() => assertSafeOutput('/p', '/p/dist', '/p/dist/protected')).toThrow(/overlaps/);
    expect(() => assertSafeOutput('/p', '/p/dist', '/p/src/out')).toThrow(/src/);
    expect(() => assertSafeOutput('/p', '/p/dist', '/p')).toThrow(/project root/);
    expect(() => assertSafeOutput('/p', '/p/dist', '/p/dist-protected')).not.toThrow();
  });
});
