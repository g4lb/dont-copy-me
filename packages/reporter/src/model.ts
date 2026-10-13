import fs from 'node:fs/promises';
import { nowIso, pathExists, readReport } from '@dont-copy-me/core';
import type { CloneBenchmarkReport } from '@dont-copy-me/benchmark';
import type { ProtectManifest } from '@dont-copy-me/notice';
import type { VerifyReport } from '@dont-copy-me/verify';

export interface HistoryEntry {
  runId: string;
  createdAt: string;
  /** The notice text the protected site carried. */
  notice: string | null;
  findings: CloneBenchmarkReport['findings'];
  metrics: Array<{
    runner: string;
    target: string;
    attempts: number;
    noticeMention: number | null;
    decline: number | null;
    similarity: number | null;
    functional: number | null;
    tokens: number | null;
    durationMs: number | null;
  }>;
}

export interface ReportModel {
  generatedAt: string;
  projectRoot: string;
  protect?: ProtectManifest;
  verify?: VerifyReport;
  clone?: CloneBenchmarkReport;
  history: HistoryEntry[];
}

export async function readHistory(file: string): Promise<HistoryEntry[]> {
  if (!(await pathExists(file))) return [];
  const lines = (await fs.readFile(file, 'utf8')).split('\n').filter(Boolean);
  const out: HistoryEntry[] = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line) as HistoryEntry);
    } catch {
      // skip corrupt line
    }
  }
  return out;
}

export function historyEntry(clone: CloneBenchmarkReport, protect: ProtectManifest | undefined): HistoryEntry {
  return {
    runId: clone.runId,
    createdAt: clone.createdAt,
    notice: protect?.rights.notice ?? null,
    findings: clone.findings,
    metrics: clone.runners.flatMap((r) =>
      r.aggregate
        ? (['baseline', 'protected'] as const).map((target) => {
            const a = r.aggregate?.[target];
            return {
              runner: r.id,
              target,
              attempts: a?.attempts ?? 0,
              noticeMention: a?.noticeMentionRate ?? null,
              decline: a?.declineRate ?? null,
              similarity: a?.similarity.mean ?? null,
              functional: a?.functionalPassRate.mean ?? null,
              tokens: a?.tokens.mean ?? null,
              durationMs: a?.durationMs.mean ?? null,
            };
          })
        : [],
    ),
  };
}

export async function loadModel(projectRoot: string, reportsDir: string, historyFile: string): Promise<ReportModel> {
  const protect = await readReport<ProtectManifest>(reportsDir, 'protect');
  const verify = await readReport<VerifyReport>(reportsDir, 'verify');
  const clone = await readReport<CloneBenchmarkReport>(reportsDir, 'benchmark-clone');
  return {
    generatedAt: nowIso(),
    projectRoot,
    ...(protect ? { protect } : {}),
    ...(verify ? { verify } : {}),
    ...(clone ? { clone } : {}),
    history: await readHistory(historyFile),
  };
}

