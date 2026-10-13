import type { DcmConfig } from '@dont-copy-me/core';
import { commandRunner } from './command.js';
import { mirrorRunner } from './mirror.js';
import { copycatAiRunner, copycatCaptureRunner } from './skills.js';
import type { CloneRunner } from './types.js';

export const RUNNER_IDS = ['mirror', 'copycat-capture', 'copycat', 'command'] as const;

/** Builds the runner set from configuration. Skill checkouts are never fetched automatically. */
export function createRunners(config: DcmConfig): Record<string, CloneRunner> {
  const clone = config.benchmark.clone;
  return {
    mirror: mirrorRunner,
    'copycat-capture': copycatCaptureRunner(clone.skills.copycat),
    copycat: copycatAiRunner(clone.skills.copycat),
    command: commandRunner(clone.command),
  };
}

export function selectRunners(all: Record<string, CloneRunner>, requested: string[]): CloneRunner[] {
  const ids = requested.includes('all') ? [...RUNNER_IDS] : requested;
  const unknown = ids.filter((id) => !(id in all));
  if (unknown.length) throw new Error(`Unknown runner(s): ${unknown.join(', ')}. Available: ${Object.keys(all).join(', ')}, all`);
  return [...new Set(ids)].map((id) => all[id] as CloneRunner);
}
