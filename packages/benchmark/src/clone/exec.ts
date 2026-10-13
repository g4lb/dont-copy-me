import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { pathExists } from '@dont-copy-me/core';
import type { ResourceStats } from './types.js';

export interface IsolatedRunOptions {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string | undefined>;
  timeoutMs: number;
  logFile: string;
  isolation: 'sandbox' | 'none';
  denyRead: string[];
  /** Initial stdin content. When set, stdin stays open until `io.end()` is called. */
  stdin?: string;
  onStdoutLine?: (line: string, io: StdinControl) => void;
}

export interface StdinControl {
  write(text: string): void;
  end(): void;
}

export interface IsolatedRunResult {
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  resources: ResourceStats;
  isolation: string;
}

function sbString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** macOS Seatbelt profile: everything allowed except reading/writing the denied paths. */
export function sandboxProfile(denyRead: string[]): string {
  const rules = denyRead.map((p) => `(deny file-read* file-write* (subpath ${sbString(p)}))`);
  return ['(version 1)', '(allow default)', ...rules].join('\n');
}

export function parseTimeOutput(stderr: string): ResourceStats | undefined {
  // BSD (macOS) `time -l`
  const bsd = /([\d.]+)\s+real\s+([\d.]+)\s+user\s+([\d.]+)\s+sys/.exec(stderr);
  const bsdRss = /(\d+)\s+maximum resident set size/.exec(stderr);
  if (bsd) {
    return {
      cpuUserMs: Math.round(Number(bsd[2]) * 1000),
      cpuSystemMs: Math.round(Number(bsd[3]) * 1000),
      ...(bsdRss ? { maxRssBytes: Number(bsdRss[1]) } : {}),
      source: 'time(1)',
    };
  }
  // GNU `time -v`
  const user = /User time \(seconds\):\s*([\d.]+)/.exec(stderr);
  const sys = /System time \(seconds\):\s*([\d.]+)/.exec(stderr);
  const rss = /Maximum resident set size \(kbytes\):\s*(\d+)/.exec(stderr);
  if (user && sys) {
    return {
      cpuUserMs: Math.round(Number(user[1]) * 1000),
      cpuSystemMs: Math.round(Number(sys[1]) * 1000),
      ...(rss ? { maxRssBytes: Number(rss[1]) * 1024 } : {}),
      source: 'time(1)',
    };
  }
  return undefined;
}

/**
 * Runs an external cloning tool without a shell, with a hard timeout (process-group kill),
 * full output logging, optional macOS sandboxing and CPU/memory accounting via time(1).
 */
export async function runIsolated(options: IsolatedRunOptions): Promise<IsolatedRunResult> {
  let command = options.command;
  let args = [...options.args];
  let isolation = 'temp working directory only (no OS sandbox)';
  const timeBin = '/usr/bin/time';
  const hasTime = await pathExists(timeBin);
  if (hasTime) {
    args = [process.platform === 'darwin' ? '-l' : '-v', command, ...args];
    command = timeBin;
  }
  if (options.isolation === 'sandbox' && process.platform === 'darwin' && (await pathExists('/usr/bin/sandbox-exec'))) {
    args = ['-p', sandboxProfile(options.denyRead), command, ...args];
    command = '/usr/bin/sandbox-exec';
    isolation = `macOS sandbox-exec; denied: ${options.denyRead.join(', ')}`;
  }
  const log = createWriteStream(options.logFile, { flags: 'a' });
  const started = performance.now();
  let stderrTail = '';
  let buffer = '';
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env } as NodeJS.ProcessEnv,
    shell: false,
    detached: process.platform !== 'win32',
    stdio: [options.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
  });
  const io: StdinControl = {
    write(text) {
      if (child.stdin && !child.stdin.writableEnded) child.stdin.write(text);
    },
    end() {
      if (child.stdin && !child.stdin.writableEnded) child.stdin.end();
    },
  };
  child.stdin?.on('error', () => undefined);
  if (options.stdin !== undefined) io.write(options.stdin);
  child.stdout?.on('data', (chunk: Buffer) => {
    log.write(chunk);
    if (!options.onStdoutLine) return;
    buffer += chunk.toString('utf8');
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      options.onStdoutLine(buffer.slice(0, idx), io);
      buffer = buffer.slice(idx + 1);
    }
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    log.write(chunk);
    stderrTail = (stderrTail + chunk.toString('utf8')).slice(-8000);
  });
  let timedOut = false;
  const kill = (signal: NodeJS.Signals): void => {
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch {
      // already exited
    }
  };
  const timer = setTimeout(() => {
    timedOut = true;
    kill('SIGTERM');
    setTimeout(() => kill('SIGKILL'), 10_000).unref();
  }, options.timeoutMs);
  const exitCode = await new Promise<number | null>((resolve) => {
    child.once('error', (error) => {
      log.write(`\n[dcm] spawn error: ${error.message}\n`);
      resolve(null);
    });
    child.once('close', (code) => resolve(code));
  });
  clearTimeout(timer);
  // Tools may leave background processes (e.g. a preview server) in the runner's process group;
  // terminate them so one attempt cannot affect the next.
  kill('SIGTERM');
  if (buffer && options.onStdoutLine) options.onStdoutLine(buffer, io);
  await new Promise<void>((resolve) => log.end(() => resolve()));
  return {
    exitCode,
    timedOut,
    durationMs: Math.round(performance.now() - started),
    resources: (hasTime ? parseTimeOutput(stderrTail) : undefined) ?? { source: 'unavailable' },
    isolation,
  };
}
