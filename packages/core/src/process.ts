import { spawn, type ChildProcess } from 'node:child_process';
import { DcmError } from './errors.js';
import { findFreePort } from './static-server.js';

export interface ManagedProcess {
  url: string;
  port: number;
  output: () => string;
  close(): Promise<void>;
}

export interface StartProcessOptions {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  readyPath?: string;
  startupTimeoutMs?: number;
  /** Values substituted for `{port}` / `{dir}` placeholders in args and env. */
  placeholders?: Record<string, string>;
}

function substitute(value: string, placeholders: Record<string, string>): string {
  return value.replace(/\{(\w+)\}/g, (match, key: string) => placeholders[key] ?? match);
}

async function waitForHttp(url: string, timeoutMs: number, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`process exited with code ${child.exitCode}`);
    try {
      const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(2000) });
      if (res.status < 500) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timed out after ${timeoutMs} ms waiting for ${url}`);
}

/**
 * Starts a framework server (e.g. `next start`) without a shell, so configuration values can
 * never be interpreted as shell syntax. The process group is terminated on close.
 */
export async function startProcess(options: StartProcessOptions): Promise<ManagedProcess> {
  const port = await findFreePort();
  const placeholders = { port: String(port), ...options.placeholders };
  const args = options.args.map((a) => substitute(a, placeholders));
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(options.env ?? {})) env[k] = substitute(v, placeholders);
  let output = '';
  const child = spawn(options.command, args, {
    cwd: options.cwd,
    env: { ...process.env, PORT: String(port), ...env },
    shell: false,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (d: Buffer) => {
    output = (output + d.toString()).slice(-20_000);
  });
  child.stderr?.on('data', (d: Buffer) => {
    output = (output + d.toString()).slice(-20_000);
  });
  const spawnError = new Promise<never>((_, reject) => child.once('error', reject));
  const url = `http://127.0.0.1:${port}`;
  const close = async (): Promise<void> => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM');
      else child.kill('SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
    const timer = setTimeout(() => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        // already gone
      }
    }, 5000);
    await exited;
    clearTimeout(timer);
  };
  try {
    await Promise.race([waitForHttp(`${url}${options.readyPath ?? '/'}`, options.startupTimeoutMs ?? 60_000, child), spawnError]);
  } catch (error) {
    await close();
    throw new DcmError('E_SERVER_START', `Could not start "${options.command} ${args.join(' ')}": ${(error as Error).message}`, {
      hint: `Last output:\n${output.slice(-1500)}`,
      cause: error,
    });
  }
  return { url, port, output: () => output, close };
}
