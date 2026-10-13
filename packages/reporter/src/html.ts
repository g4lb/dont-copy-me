import path from 'node:path';
import type { RunnerResult, Stat, TrialRecord } from '@dont-copy-me/benchmark';
import { pct } from '@dont-copy-me/core';
import { LIMITATIONS } from './markdown.js';
import type { ReportModel } from './model.js';
import { recommendations } from './recommendations.js';

const h = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const statText = (s: Stat | undefined, f: (v: number | null) => string): string => (!s || s.mean === null ? 'n/a' : `${f(s.mean)}${s.sd !== null ? ` ±${f(s.sd)}` : ''}`);

function img(reportFile: string, root: string, file: string | undefined, alt: string): string {
  if (!file) return '<div class="noimg">no screenshot</div>';
  const abs = path.isAbsolute(file) ? file : path.join(root, file);
  const rel = path.relative(path.dirname(reportFile), abs).split(path.sep).join('/');
  return `<a href="${h(rel)}" target="_blank" rel="noopener"><img loading="lazy" src="${h(rel)}" alt="${h(alt)}"></a>`;
}

function firstTrial(r: RunnerResult, target: 'baseline' | 'protected'): TrialRecord | undefined {
  return r.trials.find((t) => t.target === target && t.evaluation?.visual);
}

function verdictClass(v: string): string {
  if (v === 'protection-effective') return 'good';
  if (v === 'protection-failed') return 'bad';
  if (v === 'no-measurable-effect') return 'warn';
  return 'muted';
}

/** Self-contained local dashboard (no external resources) with before/after screenshots. */
export function renderHtml(model: ReportModel, reportFile: string): string {
  const root = model.projectRoot;
  const cards: string[] = [];
  const card = (label: string, value: string, sub = ''): void => {
    cards.push(`<div class="card"><div class="label">${h(label)}</div><div class="value">${h(value)}</div>${sub ? `<div class="sub">${h(sub)}</div>` : ''}</div>`);
  };
  if (model.protect) {
    const r = model.protect.rights;
    card('Rights notice', `${r.html} page(s)`, `${r.css + r.js} source banner(s) · owner ${r.owner}`);
  }
  if (model.verify) card('Verification', model.verify.ok ? 'Passed' : 'Failed', `${model.verify.summary.pass} passed · ${model.verify.summary.fail} failed`);
  const agent = model.clone?.runners.find((r) => r.technique === 'ai-reconstruction' && r.aggregate)?.aggregate;
  if (agent) card('Agents that declined', `${pct(agent.baseline.declineRate)} → ${pct(agent.protected.declineRate)}`, `without → with notice (n=${agent.baseline.attempts}/${agent.protected.attempts})`);

  const sections: string[] = [];
  if (model.protect) sections.push(`<section><h2>Rights notice</h2><blockquote>${h(model.protect.rights.notice)}</blockquote></section>`);

  if (model.clone) {
    const cl = model.clone;
    const findingRows = cl.findings
      .map((f) => `<tr><td>${h(f.runner)}</td><td>${h(f.technique)}</td><td>${h(f.metric)}</td><td><span class="pill ${verdictClass(f.verdict)}">${h(f.verdict)}</span></td><td>${h(f.summary)}</td></tr>`)
      .join('');
    const runnerBlocks = cl.runners
      .map((r) => {
        if (!r.executed) return `<div class="runner"><h3>${h(r.title)}</h3><p class="pill muted">not executed</p><p>${h(r.skipReason ?? r.availability.reason ?? '')}</p></div>`;
        const a = r.aggregate;
        const rows: Array<[string, string, string]> = a
          ? [
              ['Mentioned copyright/terms', pct(a.baseline.noticeMentionRate), pct(a.protected.noticeMentionRate)],
              ['Declined to copy (first answer)', pct(a.baseline.declineRate), pct(a.protected.declineRate)],
              ['Still no clone after the follow-up', a.baseline.followUpSent ? pct(a.baseline.heldAfterFollowUpRate) : 'n/a', a.protected.followUpSent ? `${pct(a.protected.heldAfterFollowUpRate)} of ${a.protected.followUpSent}` : 'n/a'],
              ['Clone kept the notice', pct(a.baseline.noticeRetainedRate), pct(a.protected.noticeRetainedRate)],
              ['Visual similarity', statText(a.baseline.similarity, pct), statText(a.protected.similarity, pct)],
              ['Above-the-fold similarity', statText(a.baseline.foldSimilarity, pct), statText(a.protected.foldSimilarity, pct)],
              ['Mobile similarity', statText(a.baseline.mobileSimilarity, pct), statText(a.protected.mobileSimilarity, pct)],
              ['Functional pass rate', statText(a.baseline.functionalPassRate, pct), statText(a.protected.functionalPassRate, pct)],
              ['Offline independent', pct(a.baseline.offlineIndependentRate), pct(a.protected.offlineIndependentRate)],
              ['Assets recovered', statText(a.baseline.assetRecovery, pct), statText(a.protected.assetRecovery, pct)],
              ['Reuses original JS', pct(a.baseline.reusesOriginalJsRate), pct(a.protected.reusesOriginalJsRate)],
              ['Clone time', statText(a.baseline.durationMs, (v) => (v === null ? 'n/a' : `${(v / 1000).toFixed(1)} s`)), statText(a.protected.durationMs, (v) => (v === null ? 'n/a' : `${(v / 1000).toFixed(1)} s`))],
              ['Tokens', statText(a.baseline.tokens, (v) => (v === null ? 'n/a' : Math.round(v).toLocaleString('en-US'))), statText(a.protected.tokens, (v) => (v === null ? 'n/a' : Math.round(v).toLocaleString('en-US')))],
              ['HTTP requests', statText(a.baseline.httpRequests, (v) => (v === null ? 'n/a' : Math.round(v).toString())), statText(a.protected.httpRequests, (v) => (v === null ? 'n/a' : Math.round(v).toString()))],
            ]
          : [];
        const table = `<table><thead><tr><th>Metric</th><th>No notice</th><th>With notice</th></tr></thead><tbody>${rows.map(([l, x, y]) => `<tr><td>${h(l)}</td><td class="num">${h(x)}</td><td class="num">${h(y)}</td></tr>`).join('')}</tbody></table>`;
        const base = firstTrial(r, 'baseline');
        const prot = firstTrial(r, 'protected');
        const views = (base?.evaluation?.visual?.views ?? []).map((v) => {
          const pv = prot?.evaluation?.visual?.views.find((x) => x.route === v.route && x.viewport === v.viewport);
          return `<figure class="triple"><figcaption>${h(v.route)} · ${h(v.viewport)}</figcaption><div class="shots">
            <div><span>Original</span>${img(reportFile, root, v.screenshots.original, 'original')}</div>
            <div><span>Clone without notice · ${pct(v.similarity)}</span>${img(reportFile, root, v.screenshots.clone, 'clone of site without notice')}</div>
            <div><span>Clone with notice · ${pct(pv?.similarity)}</span>${img(reportFile, root, pv?.screenshots.clone, 'clone of site with notice')}</div>
          </div></figure>`;
        });
        return `<div class="runner"><h3>${h(r.title)}</h3><p class="muted">${h(r.technique)}${r.upstream ? ` · ${h(r.upstream)}` : ''}</p>${table}${views.join('')}</div>`;
      })
      .join('');
    sections.push(`<section><h2>Clone benchmark</h2><p class="muted">Run ${h(cl.runId)} · ${cl.settings.trials} trial(s) · AI model ${h(cl.settings.model ?? 'runner default')} · A/B = mirroring, C/D = AI agent.</p>
      <h3>Effect of the notice by attack type</h3><table><thead><tr><th>Runner</th><th>Technique</th><th>Metric</th><th>Verdict</th><th>Evidence</th></tr></thead><tbody>${findingRows}</tbody></table>${runnerBlocks}</section>`);
  }

  if (model.verify) {
    const visual = model.verify.checks.filter((c) => c.category === 'visual').slice(0, 6);
    const checks = model.verify.checks
      .map((c) => `<tr><td><span class="pill ${c.status === 'pass' ? 'good' : c.status === 'fail' ? 'bad' : 'muted'}">${h(c.status)}</span></td><td>${h(c.title)}</td><td>${h(c.details.join('; '))}</td></tr>`)
      .join('');
    const shots = visual
      .map((c) => `<figure class="triple"><figcaption>${h(c.title)}</figcaption><div class="shots"><div><span>Original</span>${img(reportFile, root, c.artifacts?.baseline, 'original')}</div><div><span>With notice</span>${img(reportFile, root, c.artifacts?.protected, 'with notice')}</div><div><span>Pixel diff</span>${img(reportFile, root, c.artifacts?.diff, 'diff')}</div></div></figure>`)
      .join('');
    sections.push(`<section><h2>Verification</h2><table><thead><tr><th>Status</th><th>Check</th><th>Details</th></tr></thead><tbody>${checks}</tbody></table>${shots}</section>`);
  }

  const recs = recommendations(model);
  if (recs.length) {
    sections.push(`<section><h2>Recommended improvements</h2><ul class="recs">${recs.map((r) => `<li><span class="pill ${r.priority === 'high' ? 'bad' : r.priority === 'medium' ? 'warn' : 'muted'}">${h(r.priority)}</span> <strong>${h(r.title)}</strong><br><span class="muted">${h(r.why)}</span></li>`).join('')}</ul></section>`);
  }

  const body = sections.join('\n').replace(/<table>/g, '<div class="tw"><table>').replace(/<\/table>/g, '</table></div>');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Don't Copy Me Report</title>
<style>
:root{--bg:#f7f7f9;--surface:#fff;--text:#18181b;--muted:#5f6068;--border:#e4e4e9;--good:#0f7b4d;--good-bg:#e5f5ec;--bad:#b42318;--bad-bg:#fdecea;--warn:#8a5a00;--warn-bg:#fdf3dc;--accent:#4f46e5}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#111114;--surface:#1b1b20;--text:#ececf1;--muted:#a0a0ab;--border:#2c2c34;--good:#5fd39a;--good-bg:#12291f;--bad:#ff8a80;--bad-bg:#331414;--warn:#f2c46b;--warn-bg:#2e2410;--accent:#8b85ff}}
:root[data-theme="dark"]{--bg:#111114;--surface:#1b1b20;--text:#ececf1;--muted:#a0a0ab;--border:#2c2c34;--good:#5fd39a;--good-bg:#12291f;--bad:#ff8a80;--bad-bg:#331414;--warn:#f2c46b;--warn-bg:#2e2410;--accent:#8b85ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1180px;margin:0 auto;padding:32px 16px 64px}h1{margin:0 0 4px;font-size:28px}h2{margin:40px 0 8px;font-size:21px}h3{margin:24px 0 8px;font-size:17px}
.muted{color:var(--muted)}.limits{background:var(--warn-bg);color:var(--text);border:1px solid var(--border);border-radius:12px;padding:12px 16px;margin:16px 0}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-top:20px}.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 16px}
.card .label{color:var(--muted);font-size:13px}.card .value{font-size:22px;font-weight:650;margin-top:2px;font-variant-numeric:tabular-nums}.card .sub{color:var(--muted);font-size:13px}
section{margin-top:8px}.tw{overflow-x:auto;background:var(--surface);border:1px solid var(--border);border-radius:12px;margin:8px 0 16px}table{width:100%;border-collapse:collapse}tr:last-child td{border-bottom:none}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--border);vertical-align:top}th{font-size:13px;color:var(--muted);font-weight:600}td.num{font-variant-numeric:tabular-nums;white-space:nowrap}
.good{color:var(--good)}.warn{color:var(--warn)}.bad{color:var(--bad)}
.pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap}.pill.good{background:var(--good-bg)}.pill.bad{background:var(--bad-bg)}.pill.warn{background:var(--warn-bg)}.pill.muted{background:var(--border);color:var(--muted)}
.runner{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:4px 16px 12px;margin:16px 0}
.triple{margin:16px 0}.triple figcaption{font-weight:600;margin-bottom:6px}.shots{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.shots span{display:block;font-size:12px;color:var(--muted);margin-bottom:4px}.shots img{width:100%;max-height:420px;object-fit:cover;object-position:top;border:1px solid var(--border);border-radius:8px;background:#fff}
.noimg{border:1px dashed var(--border);border-radius:8px;padding:40px 8px;text-align:center;color:var(--muted);font-size:13px}
blockquote{margin:8px 0;padding:12px 16px;background:var(--surface);border-left:3px solid var(--accent);border-radius:8px}
.recs{padding-left:0;list-style:none}.recs li{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:10px 14px;margin:8px 0}
@media (max-width:720px){.shots{grid-template-columns:1fr}}
</style></head><body><main>
<h1>Don't Copy Me report</h1><p class="muted">Generated ${h(model.generatedAt)} · ${h(root)}</p>
<div class="limits"><strong>Limits.</strong> ${h(LIMITATIONS.join(' '))}</div>
<div class="cards">${cards.join('')}</div>
${body}
</main></body></html>
`;
}
