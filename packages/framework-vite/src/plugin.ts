import type { Plugin } from 'vite';

export interface DontCopyMeViteOptions {
  /** Run `dcm protect` (add the rights notice) automatically after `vite build`. Default: true. */
  protectOnBuild?: boolean;
}

/** Adds the rights notice to the build output after `vite build`. Never touches source files. */
export function dontCopyMe(options: DontCopyMeViteOptions = {}): Plugin {
  let root = process.cwd();
  let outDir = 'dist';

  return {
    name: 'dont-copy-me',
    apply: 'build',
    configResolved(resolved) {
      root = resolved.root;
      outDir = resolved.build.outDir;
    },
    async closeBundle() {
      if (options.protectOnBuild === false) return;
      const core = await import('@dont-copy-me/core');
      const notice = await import('@dont-copy-me/notice');
      const { viteAdapter } = await import('./adapter.js');
      const logger = core.createLogger();
      const loaded = await core.loadConfig(root);
      const config = { ...loaded.config, input: loaded.config.input ?? outDir };
      const project = await core.resolveProject(root, { ...config, framework: 'vite' }, [viteAdapter]);
      const manifest = await notice.protectBuild({ project, logger });
      await core.writeReport(project.reportsDir, 'protect', manifest);
      logger.success(`Don't Copy Me: rights notice added to ${manifest.rights.html} page(s) → ${manifest.output}`);
    },
  };
}
