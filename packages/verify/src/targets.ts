import path from 'node:path';
import { DcmError, ExitCode, startProcess, startStaticServer, type ProjectContext } from '@dont-copy-me/core';

export interface RunningTarget {
  label: string;
  url: string;
  close(): Promise<void>;
}

/**
 * Serves a build directory the way the framework needs: a static server for static output, or
 * the configured framework server (`verify.server`) with `{dir}` pointing at the build.
 */
export async function startTarget(project: ProjectContext, label: string, dir: string): Promise<RunningTarget> {
  if (project.adapter.serveMode === 'static') {
    const server = await startStaticServer({ root: dir, spaFallback: project.config.verify.spaFallback });
    return { label, url: server.url, close: () => server.close() };
  }
  const spec = project.config.verify.server;
  if (!spec) {
    throw new DcmError('E_NO_SERVER', `${project.adapter.displayName} builds need a server to verify`, {
      hint: 'Set verify.server in dcm.config.ts, e.g. { command: "node_modules/.bin/next", args: ["start", "-p", "{port}"], env: { DCM_DIST_DIR: "{dir}" } }.',
      exitCode: ExitCode.Config,
    });
  }
  const proc = await startProcess({
    command: spec.command,
    args: spec.args,
    cwd: project.root,
    env: spec.env,
    readyPath: spec.readyPath,
    startupTimeoutMs: spec.startupTimeoutMs,
    placeholders: { dir: path.relative(project.root, dir) || '.' },
  });
  return { label, url: proc.url, close: () => proc.close() };
}
