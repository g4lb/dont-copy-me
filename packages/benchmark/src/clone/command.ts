import { pathExists } from '@dont-copy-me/core';
import { locateClone, StreamUsageCollector } from './claude-code.js';
import { runIsolated } from './exec.js';
import type { CloneAttempt, CloneRunner, CloneTask } from './types.js';

export interface CommandRunnerSpec {
  command: string;
  args: string[];
  usageParser: 'none' | 'claude-json';
}

function substitute(value: string, task: CloneTask): string {
  return value
    .replace(/\{url\}/g, task.targetUrl)
    .replace(/\{out\}/g, task.outputDir)
    .replace(/\{workdir\}/g, task.workDir)
    .replace(/\{prompt\}/g, task.prompt);
}

/**
 * Bring-your-own reconstruction agent. The command runs without a shell in the attempt's temp
 * directory with `{url}`, `{out}`, `{workdir}` and `{prompt}` substituted in its arguments.
 */
export function commandRunner(spec: CommandRunnerSpec | undefined): CloneRunner {
  return {
    id: 'command',
    title: spec ? `Custom agent command (${spec.command})` : 'Custom agent command',
    technique: 'ai-reconstruction',
    requiresAi: true,
    async availability() {
      if (!spec) return { available: false, reason: 'benchmark.clone.command is not configured' };
      if (spec.command.includes('/') && !(await pathExists(spec.command))) return { available: false, reason: `${spec.command} does not exist` };
      return { available: true, details: { command: spec.command } };
    },
    async run(task: CloneTask): Promise<CloneAttempt> {
      const s = spec as CommandRunnerSpec;
      const collector = new StreamUsageCollector();
      const result = await runIsolated({
        command: s.command,
        args: s.args.map((a) => substitute(a, task)),
        cwd: task.workDir,
        timeoutMs: task.timeoutMs,
        logFile: task.logFile,
        isolation: task.isolation,
        denyRead: task.denyRead,
        ...(s.usageParser === 'claude-json' ? { onStdoutLine: (line: string) => collector.push(line) } : {}),
      });
      const located = await locateClone(task.workDir, task.outputDir);
      const status: CloneAttempt['status'] = result.timedOut ? 'timeout' : result.exitCode === 0 && located.dir ? 'completed' : 'failed';
      return {
        status,
        ...(status === 'failed' ? { reason: located.note ?? `exit code ${result.exitCode}` } : {}),
        durationMs: result.durationMs,
        ...(located.dir ? { cloneDir: located.dir } : {}),
        ...(s.usageParser === 'claude-json' ? { usage: collector.usage } : {}),
        resources: result.resources,
        isolation: result.isolation,
        notes: located.note ? [located.note] : [],
      };
    },
  };
}
