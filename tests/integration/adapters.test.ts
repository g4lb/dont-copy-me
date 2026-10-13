import { describe, expect, it } from 'vitest';
import { detectFramework } from '@dont-copy-me/core';
import { dontCopyMe } from '@dont-copy-me/framework-vite';
import { ADAPTERS, tempDir, writeTree } from '../helpers.js';

describe('framework detection', () => {
  it('detects Vite and falls back to static', async () => {
    const vite = await tempDir();
    await writeTree(vite, { 'package.json': '{"devDependencies":{"vite":"^8"}}', 'vite.config.ts': '' });
    expect((await detectFramework(vite, ADAPTERS))?.adapter.name).toBe('vite');

    const plain = await tempDir();
    await writeTree(plain, { 'dist/index.html': '<html></html>' });
    expect((await detectFramework(plain, ADAPTERS))?.adapter.name).toBe('static');
  });
});

describe('Vite plugin', () => {
  it('only runs at build time and never changes build settings', () => {
    const plugin = dontCopyMe();
    expect(plugin.apply).toBe('build');
    expect(plugin.config).toBeUndefined();
    expect(typeof plugin.closeBundle).toBe('function');
  });
});
