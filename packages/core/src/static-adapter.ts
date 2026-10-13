import path from 'node:path';
import type { FrameworkAdapter } from './adapter.js';
import { pathExists } from './fs-atomic.js';

/** Fallback adapter for plain static sites and unknown bundlers. */
export const staticAdapter: FrameworkAdapter = {
  name: 'static',
  displayName: 'Static site',
  defaultInput: 'dist',
  defaultOutput: 'dist-protected',
  serveMode: 'static',
  limitations: [],

  async detect(projectRoot) {
    for (const dir of ['dist', 'build', 'out', 'public']) {
      if (await pathExists(path.join(projectRoot, dir, 'index.html'))) {
        return { confidence: 0.1, evidence: [`found ${dir}/index.html`] };
      }
    }
    return null;
  },
};
