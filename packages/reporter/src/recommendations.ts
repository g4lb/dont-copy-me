import type { ReportModel } from './model.js';

export interface Recommendation {
  priority: 'high' | 'medium' | 'low';
  title: string;
  why: string;
}

/** Derives recommendations strictly from measured data in the model. */
export function recommendations(model: ReportModel): Recommendation[] {
  const out: Recommendation[] = [];
  const r = model.protect?.rights;
  if (r) {
    if (r.owner === 'the site owner') out.push({ priority: 'high', title: 'Name the rights holder', why: 'The notice says "the site owner". Set rights.owner to your legal name so the notice identifies who holds the rights.' });
    if (!r.contact && !r.termsUrl) out.push({ priority: 'medium', title: 'Give readers a way to ask for permission', why: 'Agents that stop usually ask their user to confirm permission. A contact address or terms page tells them where permission comes from.' });
    if (!r.siteUrl) out.push({ priority: 'low', title: 'Set rights.siteUrl', why: 'The canonical address shows that a copy served elsewhere comes from your public site.' });
  }
  const verify = model.verify;
  if (verify && !verify.ok) {
    out.push({ priority: 'high', title: 'Do not deploy: verification failed', why: verify.checks.filter((c) => c.status === 'fail').map((c) => c.title).slice(0, 3).join('; ') });
  }
  const clone = model.clone;
  if (clone) {
    const ai = clone.runners.filter((x) => x.technique === 'ai-reconstruction');
    if (ai.length && ai.every((x) => !x.executed)) {
      out.push({ priority: 'low', title: 'Run the AI clone benchmark', why: `AI runners were not executed (${ai.map((x) => `${x.id}: ${x.skipReason ?? 'unavailable'}`).join('; ')}). Without them, the effect of the notice on agents is unmeasured.` });
    }
    if (clone.findings.some((f) => f.verdict === 'protection-failed' && f.technique === 'asset-mirroring')) {
      out.push({ priority: 'medium', title: 'Scripted mirroring ignores the notice', why: 'Mirroring tools copy the notice along with the site. robots.txt mirror rules and crawler rules (see `dcm shield`) ask tools not to copy; they do not stop one that ignores them.' });
    }
    if (clone.settings.trials < 4) {
      out.push({ priority: 'low', title: 'Run at least 4 trials per side', why: 'Agents are nondeterministic; small samples make decline rates unreliable.' });
    }
  }
  return out;
}
