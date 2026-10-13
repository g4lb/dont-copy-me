import { formatBytes, pct } from '@dont-copy-me/core';
import type { Aggregate, RunnerResult, Stat } from '@dont-copy-me/benchmark';
import type { ReportModel } from './model.js';
import { recommendations } from './recommendations.js';

export const LIMITATIONS = [
  'A public website cannot be made uncopyable. Anything the browser renders can be copied.',
  "Don't Copy Me adds an honest rights notice for people and machines. It states your terms; it does not technically prevent copying.",
  'Careful AI agents often stop and ask their user for permission; a user who claims permission usually gets the clone. Scripted mirroring tools ignore the notice.',
];

const num = (v: number | null | undefined, digits = 0): string => (v === null || v === undefined ? 'n/a' : v.toLocaleString('en-US', { maximumFractionDigits: digits }));
const sd = (s: Stat, fmt: (v: number | null) => string): string => (s.mean === null ? 'n/a' : `${fmt(s.mean)}${s.sd !== null ? ` ± ${fmt(s.sd)}` : ''}`);
const mins = (v: number | null): string => (v === null ? 'n/a' : `${(v / 60000).toFixed(1)} min`);
const esc = (s: string): string => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

function aggregateRows(a: Aggregate): Array<[string, string]> {
  return [
    ['Attempts (completed)', `${a.attempts} (${a.completed})`],
    ['Clone time', sd(a.durationMs, mins)],
    ['Visual similarity (all views)', sd(a.similarity, pct)],
    ['Above-the-fold similarity', sd(a.foldSimilarity, pct)],
    ['Desktop / mobile similarity', `${sd(a.desktopSimilarity, pct)} / ${sd(a.mobileSimilarity, pct)}`],
    ['Text recall', sd(a.textRecall, pct)],
    ['Functional flow pass rate', sd(a.functionalPassRate, pct)],
    ['Agent mentioned copyright/terms', pct(a.noticeMentionRate)],
    ['Agent declined to copy (first answer)', pct(a.declineRate)],
    ['Follow-up sent / still no clone after it', a.followUpSent ? `${a.followUpSent} / ${pct(a.heldAfterFollowUpRate)}` : 'n/a'],
    ['Clone kept the notice', pct(a.noticeRetainedRate)],
    ['Offline independent', pct(a.offlineIndependentRate)],
    ['Assets recovered', sd(a.assetRecovery, pct)],
    ['Reuses original JS verbatim', pct(a.reusesOriginalJsRate)],
    ['Tokens', sd(a.tokens, (v) => num(v))],
    ['API-equivalent cost (USD; not billed on subscriptions)', sd(a.costUsd, (v) => (v === null ? 'n/a' : `$${v.toFixed(2)}`))],
    ['Agent tool calls', sd(a.toolCalls, (v) => num(v))],
    ['HTTP requests to target', sd(a.httpRequests, (v) => num(v))],
    ['CPU time', sd(a.cpuMs, (v) => (v === null ? 'n/a' : `${(v / 1000).toFixed(1)} s`))],
    ['Peak memory', sd(a.maxRssBytes, (v) => (v === null ? 'n/a' : formatBytes(v)))],
  ];
}

function runnerSection(r: RunnerResult, lines: string[]): void {
  lines.push(`### ${r.title}`, '');
  lines.push(`- Runner: \`${r.id}\` · technique: **${r.technique}**${r.upstream ? ` · upstream: ${r.upstream}` : ''}`);
  if (!r.executed) {
    lines.push(`- **Not executed:** ${r.skipReason ?? r.availability.reason ?? 'unavailable'}`, '');
    return;
  }
  if (!r.aggregate) return;
  lines.push('', '| Metric | Baseline (no notice) | With notice |', '|---|---|---|');
  const a = aggregateRows(r.aggregate.baseline);
  const b = aggregateRows(r.aggregate.protected);
  a.forEach(([label, value], i) => lines.push(`| ${label} | ${value} | ${b[i]?.[1] ?? ''} |`));
  lines.push('');
  for (const t of r.trials) {
    const notes = [...t.attempt.notes, ...(t.evaluation?.notes ?? [])].slice(0, 4).join('; ');
    lines.push(`- Scenario ${t.scenario} · ${t.target} · trial ${t.trial}: **${t.attempt.status}**${t.attempt.reason ? ` (${esc(t.attempt.reason)})` : ''}${notes ? ` — ${esc(notes)}` : ''} · artifacts: \`${t.artifacts}\``);
  }
  lines.push('');
}

export function renderMarkdown(model: ReportModel): string {
  const L: string[] = [];
  L.push("# Don't Copy Me report", '', `Generated ${model.generatedAt} for \`${model.projectRoot}\`.`, '');
  L.push('> **Limits.** ' + LIMITATIONS.join(' '), '');

  L.push('## Summary', '', '| Area | Result |', '|---|---|');
  if (model.protect) {
    const r = model.protect.rights;
    L.push(`| Notice | ${r.html} page(s), ${r.css + r.js} source banner(s)${r.tdmrep ? ', TDMRep' : ''}${r.structuredData ? ', JSON-LD' : ''} · owner ${esc(r.owner)} |`);
  } else L.push('| Notice | not added yet (`dcm protect`) |');
  if (model.verify) L.push(`| Verify | ${model.verify.ok ? '✅ passed' : '❌ failed'} · ${model.verify.summary.pass} passed, ${model.verify.summary.fail} failed |`);
  else L.push('| Verify | not run |');
  if (model.clone) {
    const executed = model.clone.runners.filter((r) => r.executed).map((r) => r.id);
    const skipped = model.clone.runners.filter((r) => !r.executed).map((r) => r.id);
    L.push(`| Clone benchmark | executed: ${executed.join(', ') || 'none'}${skipped.length ? ` · not executed: ${skipped.join(', ')}` : ''} |`);
  } else L.push('| Clone benchmark | not run |');
  L.push('');

  if (model.protect) {
    const p = model.protect;
    const r = p.rights;
    L.push('## Rights notice', '', `> ${esc(r.notice)}`, '');
    L.push(`- Visible line: ${r.visible ? 'yes' : 'no'} · source banners: ${r.sourceBanners ? `${r.css} CSS, ${r.js} JS` : 'off'} · JSON-LD: ${r.structuredData ? 'yes' : 'no'} · noai meta: ${r.noAiMeta ? 'yes' : 'no'} · TDMRep: ${r.tdmReservation ? 'yes' : 'no'}`);
    L.push(`- Terms: ${r.termsUrl ?? 'not set'} · permission contact: ${r.contact ?? 'not set'} · original site: ${r.siteUrl ?? 'not set'}`);
    if (p.integrityUpdates) L.push(`- ${p.integrityUpdates} Subresource Integrity hash(es) updated for the banners.`);
    for (const w of p.warnings) L.push(`- ⚠ ${w}`);
    for (const l of p.limitations) L.push(`- ℹ ${l}`);
    L.push('');
  }

  if (model.verify) {
    const v = model.verify;
    L.push('## Verification', '', `${v.routes.length} route(s) × ${v.viewports.join(', ')}.`, '');
    for (const c of v.checks) L.push(`- ${c.status === 'pass' ? '✅' : c.status === 'fail' ? '❌' : c.status === 'warn' ? '⚠️' : '➖'} ${esc(c.title)}${c.status !== 'pass' ? ` — ${esc(c.details.join('; '))}` : ''}`);
    if (v.performance) {
      const a = v.performance.baseline.median;
      const b = v.performance.protected.median;
      L.push('', '| Metric (median) | Original | With notice |', '|---|---|---|');
      L.push(`| Load event | ${num(a.loadMs, 1)} ms | ${num(b.loadMs, 1)} ms |`);
      L.push(`| Largest contentful paint | ${num(a.largestContentfulPaintMs, 1)} ms | ${num(b.largestContentfulPaintMs, 1)} ms |`);
      L.push(`| Cumulative layout shift | ${num(a.cumulativeLayoutShift, 3)} | ${num(b.cumulativeLayoutShift, 3)} |`);
      L.push('', `_Loopback measurements over ${v.performance.baseline.runs} cold load(s); compare relative differences only._`);
    }
    L.push('');
  }

  if (model.clone) {
    const cl = model.clone;
    L.push('## Clone benchmark', '');
    L.push(`Run \`${cl.runId}\` · ${cl.settings.trials} trial(s) per runner and target · time budget ${mins(cl.settings.timeoutMs)} · model ${cl.settings.model ?? 'runner default'} · isolation: ${cl.settings.isolation}`);
    L.push(`Environment: ${cl.environment.platform} ${cl.environment.release}, ${cl.environment.cpu} ×${cl.environment.cpus}, ${cl.environment.memoryGb} GB, Node ${cl.environment.node}, Chromium ${cl.environment.chromium}.`);
    L.push(`Sites: baseline \`${cl.settings.sites.baseline}\`, with notice \`${cl.settings.sites.protected}\`. Routes ${cl.settings.routes.join(', ')}; viewports ${cl.settings.viewports.join(', ')}; flows ${cl.settings.flows.join(', ') || 'none'}.`, '');
    L.push('Scenarios: **A** no notice → mirroring · **B** notice → mirroring · **C** no notice → AI agent · **D** notice → AI agent.', '');
    for (const r of cl.runners) runnerSection(r, L);
    L.push('### Effect of the notice by attack type', '', '| Runner | Technique | Metric | Verdict | Evidence |', '|---|---|---|---|---|');
    for (const f of cl.findings) L.push(`| ${f.runner} | ${f.technique} | ${esc(f.metric)} | **${f.verdict}** | ${esc(f.summary)} |`);
    L.push('', '### Limitations and failed defenses', '');
    for (const f of cl.findings.filter((x) => x.verdict === 'protection-failed')) L.push(`- ❌ ${esc(f.summary)}`);
    for (const l of cl.limitations) L.push(`- ${l}`);
    L.push('');
  }

  if (model.history.length >= 2) {
    const [prev, last] = model.history.slice(-2) as [ReportModel['history'][number], ReportModel['history'][number]];
    L.push('## Change since previous benchmark', '', `Previous \`${prev.runId}\` → latest \`${last.runId}\``, '');
    L.push('| Runner | Target | Mentioned notice | Declined | Similarity | Tokens |', '|---|---|---|---|---|---|');
    for (const m of last.metrics) {
      const p = prev.metrics.find((x) => x.runner === m.runner && x.target === m.target);
      const d = (a: number | null | undefined, b: number | null, f: (v: number | null) => string): string => `${f(a ?? null)} → ${f(b)}`;
      L.push(`| ${m.runner} | ${m.target} | ${d(p?.noticeMention, m.noticeMention, pct)} | ${d(p?.decline, m.decline, pct)} | ${d(p?.similarity, m.similarity, pct)} | ${d(p?.tokens, m.tokens, (v) => num(v))} |`);
    }
    L.push('');
  }

  const recs = recommendations(model);
  if (recs.length) {
    L.push('## Recommended improvements', '');
    for (const r of recs) L.push(`- **[${r.priority}] ${r.title}** — ${r.why}`);
    L.push('');
  }
  return `${L.join('\n')}\n`;
}
