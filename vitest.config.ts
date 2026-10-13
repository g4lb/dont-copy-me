import path from 'node:path';
import { defineConfig } from 'vitest/config';

const pkgs = ['core', 'notice', 'benchmark', 'verify', 'framework-vite', 'reporter', 'shield'];
const alias = Object.fromEntries(pkgs.map((p) => [`@dont-copy-me/${p}`, path.resolve(import.meta.dirname, `packages/${p}/src/index.ts`)]));
alias['dont-copy-me'] = path.resolve(import.meta.dirname, 'packages/cli/src/index.ts');

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: { name: 'unit', include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'], testTimeout: 60_000 },
      },
      {
        resolve: { alias },
        test: { name: 'browser', include: ['tests/browser/**/*.test.ts'], testTimeout: 240_000, hookTimeout: 240_000, fileParallelism: false },
      },
    ],
  },
});
