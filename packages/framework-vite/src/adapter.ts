import path from 'node:path';
import { dependencyVersion, pathExists, readPackageJson, type FrameworkAdapter } from '@dont-copy-me/core';

const VITE_CONFIGS = ['vite.config.ts', 'vite.config.mts', 'vite.config.js', 'vite.config.mjs', 'vite.config.cjs'];

/** Vite build adapter: client output in `dist/`, served as static files. */
export const viteAdapter: FrameworkAdapter = {
  name: 'vite',
  displayName: 'Vite',
  defaultInput: 'dist',
  defaultOutput: 'dist-protected',
  serveMode: 'static',
  limitations: ['Only client-side output in the build directory is processed; SSR bundles (dist/server) get banners but no page notice.'],

  async detect(projectRoot) {
    const evidence: string[] = [];
    const pkg = await readPackageJson(projectRoot);
    const version = dependencyVersion(pkg, 'vite');
    if (version) evidence.push(`package.json depends on vite@${version}`);
    for (const name of VITE_CONFIGS) {
      if (await pathExists(path.join(projectRoot, name))) {
        evidence.push(`found ${name}`);
        break;
      }
    }
    if (evidence.length === 0) return null;
    return { confidence: evidence.length === 2 ? 0.95 : 0.7, evidence };
  },
};
