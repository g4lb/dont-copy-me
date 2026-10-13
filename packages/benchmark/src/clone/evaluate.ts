import fs from 'node:fs/promises';
import path from 'node:path';
import type { Browser } from 'playwright';
import { createPolicy, decodeEntities, kindFromPath, pathExists, RIGHTS_ATTR, sha256, slug, startStaticServer, walkFiles, type DcmConfig, type Flow, type Viewport } from '@dont-copy-me/core';
import { capturePage, comparePngs, cropHeight, newStableContext, runFlow, type PageCapture } from '@dont-copy-me/verify';
import { guardContext, newLedger } from '../guard.js';
import type { CloneAttempt, Technique } from './types.js';

/** Hostname used to serve clones during evaluation; must be mapped in the browser launch args. */
export const CLONE_HOST = 'dcm-clone.test';
/** Text of the label that dcm's copy check shows on hosts other than the original. */
const COPY_LABEL = /This is a copy of https?:\/\/\S+ .{1,120} has not licensed it[.,]/;

export const CLONE_HOST_ARGS = [`--host-resolver-rules=MAP ${CLONE_HOST} 127.0.0.1`];

export interface ViewResult {
  route: string;
  viewport: string;
  similarity: number;
  /** Similarity of the first screen only (what a landing-page visitor sees first). */
  foldSimilarity: number;
  textRecall: number;
  cloneStatus: number | null;
  screenshots: { original: string; clone: string; diff: string };
}

export interface CloneEvaluation {
  runnable: boolean;
  visual: {
    views: ViewResult[];
    meanSimilarity: number;
    meanFoldSimilarity: number;
    desktopSimilarity: number | null;
    mobileSimilarity: number | null;
    meanTextRecall: number;
  } | null;
  functional: { flows: Array<{ name: string; ok: boolean; failedStep?: string }>; passRate: number; applicable: number } | null;
  /** Whether the clone kept the original's rights notice (null when the original has none). */
  noticeRetained: boolean | null;
  /** The copy showed the "This is a copy of …" label when served from another host. */
  copyLabelShown?: boolean | null;
  offline: { independent: boolean; requestsToOriginal: number; externalRequests: number; blockedSample: string[] } | null;
  assets: { originalCount: number; recoveredExact: number; recoveredByName: number; recoveredRatio: number; reusesOriginalJs: boolean; reusedJsFiles: string[] };
  extraction: { files: number; css: number; images: number; fonts: number; textRecall: number | null } | null;
  notes: string[];
}

export interface OriginalReference {
  url: string;
  dir: string;
  captures: Map<string, PageCapture>;
  flows: Map<string, boolean>;
  assetHashes: Map<string, string>;
  jsHashes: Set<string>;
  /** Normalized fragment of the original's rights notice, used to see whether a clone kept it. */
  noticeKey?: string;
}

const TEXT_FILE = /\.(?:m?js|cjs|jsx|tsx?|html?|vue|svelte|css)$/i;

function words(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z0-9$%][a-z0-9$%.,'-]{2,}/g) ?? []).map((w) => w.replace(/[.,]+$/, '')));
}

function recall(original: string, clone: string): number {
  const a = words(original);
  if (a.size === 0) return 0;
  const b = words(clone);
  let hit = 0;
  for (const w of a) if (b.has(w)) hit++;
  return hit / a.size;
}

function normalize(text: string): string {
  return decodeEntities(text)
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** Longest sentence of the visible notice in the original's entry page, normalized. */
export function noticeKeyFromHtml(html: string): string | undefined {
  const text = new RegExp(`<p\\b[^>]*${RIGHTS_ATTR}[^>]*>([^<]+)`, 'i').exec(html)?.[1];
  if (!text) return undefined;
  const sentence = normalize(text)
    .split(/(?<=\.)\s+/)
    .sort((a, b) => b.length - a.length)[0];
  return sentence?.slice(0, 60);
}

/** Captures the original once per target so every attempt is compared with the same images. */
export async function captureOriginal(
  browser: Browser,
  config: DcmConfig,
  url: string,
  dir: string,
  routes: string[],
  viewports: Viewport[],
  flows: Flow[],
): Promise<OriginalReference> {
  const captures = new Map<string, PageCapture>();
  for (const viewport of viewports) {
    const ctx = await newStableContext(browser, viewport, config.browser);
    try {
      for (const route of routes) {
        captures.set(`${viewport.name}:${route}`, await capturePage(ctx, new URL(route, url).toString(), { timeoutMs: 30_000, ignoreConsole: [] }));
      }
    } finally {
      await ctx.close();
    }
  }
  const flowResults = new Map<string, boolean>();
  const first = viewports[0] as Viewport;
  for (const flow of flows) {
    const ctx = await newStableContext(browser, first, config.browser);
    try {
      flowResults.set(flow.name, (await runFlow(ctx, url, flow, 30_000, [])).ok);
    } finally {
      await ctx.close();
    }
  }
  const assetHashes = new Map<string, string>();
  const jsHashes = new Set<string>();
  for (const file of await walkFiles(dir)) {
    const kind = kindFromPath(file);
    if (kind === 'html' || kind === 'sourcemap' || kind === 'other') continue;
    const hash = sha256(await fs.readFile(path.join(dir, file)));
    assetHashes.set(hash, file);
    if (kind === 'js') jsHashes.add(hash);
  }
  const entry = path.join(dir, 'index.html');
  const noticeKey = (await pathExists(entry)) ? noticeKeyFromHtml(await fs.readFile(entry, 'utf8')) : undefined;
  return { url, dir, captures, flows: flowResults, assetHashes, jsHashes, ...(noticeKey ? { noticeKey } : {}) };
}

async function cloneFiles(dir: string): Promise<string[]> {
  return (await walkFiles(dir)).filter((f) => !f.includes('node_modules/') && !f.startsWith('.claude/') && !f.startsWith('.git/'));
}

export async function evaluateAttempt(input: {
  browser: Browser;
  config: DcmConfig;
  technique: Technique;
  attempt: CloneAttempt;
  original: OriginalReference;
  routes: string[];
  viewports: Viewport[];
  flows: Flow[];
  artifactsDir: string;
}): Promise<CloneEvaluation> {
  const { attempt, original, browser, config } = input;
  const notes: string[] = [];
  const material = attempt.cloneDir ?? attempt.extractDir;
  const files = material && (await pathExists(material)) ? await cloneFiles(material) : [];

  // Asset recovery and verbatim reuse of the original JavaScript.
  const byName = new Set([...original.assetHashes.values()].map((f) => path.posix.basename(f)));
  let recoveredExact = 0;
  let recoveredByName = 0;
  const reused: string[] = [];
  const seenHashes = new Set<string>();
  const cloneNames = new Set<string>();
  let corpus = '';
  for (const file of files) {
    const abs = path.join(material as string, file);
    const buf = await fs.readFile(abs);
    const hash = sha256(buf);
    if (original.assetHashes.has(hash) && !seenHashes.has(hash)) {
      seenHashes.add(hash);
      recoveredExact++;
      if (original.jsHashes.has(hash)) reused.push(file);
    }
    cloneNames.add(path.posix.basename(file));
    if (TEXT_FILE.test(file) && buf.length < 5 * 1024 * 1024) corpus += `\n${buf.toString('utf8')}`;
  }
  for (const name of byName) if (cloneNames.has(name)) recoveredByName++;
  const originalCount = original.assetHashes.size;
  const assets = {
    originalCount,
    recoveredExact,
    recoveredByName,
    recoveredRatio: originalCount ? Math.max(recoveredExact, recoveredByName) / originalCount : 0,
    reusesOriginalJs: reused.length > 0,
    reusedJsFiles: reused,
  };

  const noticeRetained = original.noticeKey && files.length ? normalize(corpus).includes(original.noticeKey) : null;

  if (input.technique === 'asset-extraction' || !attempt.cloneDir) {
    let textRecall: number | null = null;
    const textFile = material ? path.join(material, 'content', 'text.md') : undefined;
    const home = original.captures.get(`${input.viewports[0]?.name}:/`);
    if (textFile && home && (await pathExists(textFile))) textRecall = recall(home.text, await fs.readFile(textFile, 'utf8'));
    return {
      runnable: false,
      visual: null,
      functional: null,
      noticeRetained,
      offline: null,
      assets,
      extraction: files.length
        ? {
            files: files.length,
            css: files.filter((f) => f.endsWith('.css')).length,
            images: files.filter((f) => /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(f) && !f.startsWith('screens/')).length,
            fonts: files.filter((f) => /\.(woff2?|ttf|otf)$/i.test(f)).length,
            textRecall,
          }
        : null,
      notes: input.technique === 'asset-extraction' ? ['asset extraction produces material for a rebuild, not a runnable clone'] : ['no runnable clone was produced'],
    };
  }

  // Serve the clone offline: only its own origin is reachable. Requests back to the original
  // or to third parties are blocked and counted.
  const server = await startStaticServer({ root: attempt.cloneDir, spaFallback: true });
  // Served under a non-loopback hostname (mapped to 127.0.0.1 by the browser's host resolver
  // rules), as it would be on another domain.
  const cloneUrl = server.url.replace('127.0.0.1', CLONE_HOST);
  const ledger = newLedger();
  const policy = createPolicy([cloneUrl]);
  const views: ViewResult[] = [];
  const flowsOut: Array<{ name: string; ok: boolean; failedStep?: string }> = [];
  let labelled = false;
  try {
    for (const viewport of input.viewports) {
      const ctx = await newStableContext(browser, viewport, config.browser);
      await guardContext(ctx, policy, 5000, ledger);
      try {
        for (const route of input.routes) {
          const orig = original.captures.get(`${viewport.name}:${route}`);
          if (!orig) continue;
          let clone: PageCapture;
          try {
            clone = await capturePage(ctx, new URL(route, cloneUrl).toString(), { timeoutMs: 30_000, ignoreConsole: [] });
          } catch (error) {
            notes.push(`${route} (${viewport.name}) failed to load: ${(error as Error).message.split('\n')[0]}`);
            continue;
          }
          if (COPY_LABEL.test(clone.text)) labelled = true;
          const cmp = comparePngs(orig.screenshot, clone.screenshot, 0.1);
          const base = path.join(input.artifactsDir, `${viewport.name}-${slug(route)}`);
          await fs.mkdir(path.dirname(base), { recursive: true });
          const shots = { original: `${base}-original.png`, clone: `${base}-clone.png`, diff: `${base}-diff.png` };
          await fs.writeFile(shots.original, cropHeight(orig.screenshot, 2400));
          await fs.writeFile(shots.clone, cropHeight(clone.screenshot, 2400));
          await fs.writeFile(shots.diff, cropHeight(cmp.diffPng, 2400));
          const fold = comparePngs(cropHeight(orig.screenshot, viewport.height), cropHeight(clone.screenshot, viewport.height), 0.1);
          views.push({
            route,
            viewport: viewport.name,
            similarity: cmp.similarity,
            foldSimilarity: fold.similarity,
            textRecall: recall(orig.text, clone.text),
            cloneStatus: clone.status,
            screenshots: shots,
          });
        }
      } finally {
        await ctx.close();
      }
    }
    for (const flow of input.flows) {
      if (!original.flows.get(flow.name)) continue; // only flows that pass on the original are meaningful
      const ctx = await newStableContext(browser, input.viewports[0] as Viewport, config.browser);
      await guardContext(ctx, policy, 5000, ledger);
      try {
        const r = await runFlow(ctx, cloneUrl, flow, 20_000, []);
        const failed = r.steps.find((s) => !s.ok);
        flowsOut.push({ name: flow.name, ok: r.ok, ...(failed ? { failedStep: `${failed.step}: ${failed.error ?? ''}` } : {}) });
      } finally {
        await ctx.close();
      }
    }
  } finally {
    await server.close();
  }
  const originOfOriginal = new URL(original.url).origin;
  const toOriginal = ledger.blocked.filter((u) => u.startsWith(originOfOriginal)).length;
  const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const desktop = views.filter((v) => v.viewport === input.viewports[0]?.name);
  const mobile = views.filter((v) => v.viewport !== input.viewports[0]?.name);
  const copyLabelShown = views.length ? labelled : null;
  return {
    runnable: views.length > 0,
    visual: views.length
      ? {
          views,
          meanSimilarity: mean(views.map((v) => v.similarity)),
          meanFoldSimilarity: mean(views.map((v) => v.foldSimilarity)),
          desktopSimilarity: desktop.length ? mean(desktop.map((v) => v.similarity)) : null,
          mobileSimilarity: mobile.length ? mean(mobile.map((v) => v.similarity)) : null,
          meanTextRecall: mean(views.map((v) => v.textRecall)),
        }
      : null,
    functional: flowsOut.length ? { flows: flowsOut, passRate: flowsOut.filter((f) => f.ok).length / flowsOut.length, applicable: flowsOut.length } : null,
    noticeRetained,
    copyLabelShown,
    offline: { independent: ledger.blocked.length === 0, requestsToOriginal: toOriginal, externalRequests: ledger.blocked.length - toOriginal, blockedSample: ledger.blocked.slice(0, 8) },
    assets,
    extraction: null,
    notes,
  };
}
