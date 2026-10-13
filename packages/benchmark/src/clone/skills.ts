import fs from 'node:fs/promises';
import path from 'node:path';
import { pathExists, walkFiles } from '@dont-copy-me/core';
import { claudeAvailable, installSkill, runClaudeSession } from './claude-code.js';
import { runIsolated } from './exec.js';
import type { CloneAttempt, CloneRunner, CloneTask, RunnerAvailability } from './types.js';

export const COPYCAT_UPSTREAM = 'https://github.com/minosdevs/copycat-skill';

async function readSkillName(skillDir: string): Promise<string | undefined> {
  try {
    const text = await fs.readFile(path.join(skillDir, 'SKILL.md'), 'utf8');
    return /^name:\s*([\w-]+)/m.exec(text)?.[1];
  } catch {
    return undefined;
  }
}

async function copycatChecks(skillDir: string | undefined): Promise<RunnerAvailability> {
  if (!skillDir) {
    return { available: false, reason: `benchmark.clone.skills.copycat is not set. Clone ${COPYCAT_UPSTREAM} locally and point the config at it.` };
  }
  if ((await readSkillName(skillDir)) !== 'copycat') return { available: false, reason: `${skillDir} does not contain the copycat SKILL.md` };
  if (!(await pathExists(path.join(skillDir, 'scripts', 'node_modules', 'playwright')))) {
    return {
      available: false,
      reason: `copycat's own dependencies are not installed. Review them, then run: cd ${path.join(skillDir, 'scripts')} && npm install`,
    };
  }
  return { available: true, details: { skillDir } };
}

/**
 * Copycat's deterministic capture script (scripts/capture.mjs), executed unmodified. It extracts
 * rendered DOM, CSS, fonts, images and screenshots for a later AI rebuild; it does not produce a
 * runnable clone by itself, so it is evaluated as asset extraction.
 */
export function copycatCaptureRunner(skillDir: string | undefined): CloneRunner {
  return {
    id: 'copycat-capture',
    title: 'Copycat capture.mjs (asset extraction, unmodified upstream script)',
    technique: 'asset-extraction',
    requiresAi: false,
    upstream: COPYCAT_UPSTREAM,
    availability: () => copycatChecks(skillDir),
    async run(task: CloneTask): Promise<CloneAttempt> {
      // Run from a private copy so the sandbox can deny the project directory entirely.
      const dir = await installSkill(skillDir as string, task.workDir, 'copycat');
      const result = await runIsolated({
        command: process.execPath,
        args: [path.join(dir, 'scripts', 'capture.mjs'), task.targetUrl, '--out', task.outputDir, '--viewports', 'desktop,mobile', '--depth', '1', '--max-pages', String(task.maxPages), '--no-hover'],
        cwd: task.workDir,
        timeoutMs: task.timeoutMs,
        logFile: task.logFile,
        isolation: task.isolation,
        denyRead: task.denyRead,
      });
      const produced = (await pathExists(task.outputDir)) ? (await walkFiles(task.outputDir)).length : 0;
      return {
        status: result.timedOut ? 'timeout' : result.exitCode === 0 ? 'completed' : 'failed',
        ...(result.exitCode !== 0 && !result.timedOut ? { reason: `capture.mjs exited with code ${result.exitCode}` } : {}),
        durationMs: result.durationMs,
        extractDir: task.outputDir,
        resources: result.resources,
        isolation: result.isolation,
        notes: [`${produced} file(s) extracted`],
      };
    },
  };
}

/** Copycat end to end: Claude Code headless with the unmodified copycat skill installed. */
export function copycatAiRunner(skillDir: string | undefined): CloneRunner {
  return {
    id: 'copycat',
    title: 'Copycat skill + Claude Code (AI reconstruction)',
    technique: 'ai-reconstruction',
    requiresAi: true,
    upstream: COPYCAT_UPSTREAM,
    async availability() {
      const base = await copycatChecks(skillDir);
      if (!base.available) return base;
      const claude = claudeAvailable();
      if (!claude.available) return { available: false, reason: 'the `claude` CLI (Claude Code) is not on PATH' };
      return { available: true, details: { ...base.details, claude: claude.version ?? 'unknown' } };
    },
    async run(task: CloneTask): Promise<CloneAttempt> {
      await installSkill(skillDir as string, task.workDir, 'copycat');
      const prompt = `${task.prompt}\nUse the copycat skill.`;
      return runClaudeSession({ ...task, prompt }, ['skill: copycat (unmodified)']);
    },
  };
}
