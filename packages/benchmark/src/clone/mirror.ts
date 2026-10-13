import fs from 'node:fs/promises';
import path from 'node:path';
import { isInside } from '@dont-copy-me/core';
import { guardedFetch } from '../fetch.js';
import { newLedger } from '../guard.js';
import type { CloneAttempt, CloneRunner, CloneTask } from './types.js';

const ASSET_EXT = /\.(?:m?js|css|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|json|webmanifest|txt|xml|mp4|webm|wasm)$/i;

/** Maps a URL path to a file inside the mirror, refusing anything that escapes it. */
function localPath(root: string, pathname: string, isHtml: boolean): string | undefined {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  else if (isHtml && !path.extname(rel)) rel += '/index.html';
  const abs = path.join(root, rel);
  return isInside(root, abs) ? abs : undefined;
}

export function discoverFromHtml(html: string, base: string): { assets: string[]; pages: string[] } {
  const assets = new Set<string>();
  const pages = new Set<string>();
  for (const m of html.matchAll(/<(script|link|img|source|video|audio|iframe)\b[^>]*?\s(?:src|href)\s*=\s*["']([^"'#]+)["']/gi)) {
    if (m[2]) assets.add(new URL(m[2], base).toString());
  }
  for (const m of html.matchAll(/\ssrcset\s*=\s*["']([^"']+)["']/gi)) {
    for (const part of (m[1] ?? '').split(',')) {
      const url = part.trim().split(/\s+/)[0];
      if (url) assets.add(new URL(url, base).toString());
    }
  }
  for (const m of html.matchAll(/<a\b[^>]*?\shref\s*=\s*["']([^"'#]+)["']/gi)) {
    if (m[1]) pages.add(new URL(m[1], base).toString());
  }
  for (const m of html.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
    if (m[1] && !m[1].startsWith('data:')) assets.add(new URL(m[1], base).toString());
  }
  return { assets: [...assets], pages: [...pages] };
}

export function discoverFromCss(css: string, base: string): string[] {
  const out = new Set<string>();
  for (const m of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
    if (m[1] && !m[1].startsWith('data:') && !m[1].startsWith('#')) out.add(new URL(m[1], base).toString());
  }
  for (const m of css.matchAll(/@import\s+["']([^"']+)["']/g)) if (m[1]) out.add(new URL(m[1], base).toString());
  return [...out];
}

/**
 * Finds module specifiers and asset-looking string literals in JavaScript, the way mirroring
 * tools follow lazy chunks.
 */
export function discoverFromJs(code: string, base: string): string[] {
  const out = new Set<string>();
  const patterns = [
    /\bfrom\s*["'`]([^"'`]+)["'`]/g,
    /\bimport\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
    /\bimport\s*["'`]([^"'`]+)["'`]/g,
    /["'`]((?:\.{1,2}\/|\/)?[\w@./-]+\.(?:m?js|css|png|jpe?g|gif|webp|avif|svg|woff2?|ttf|json|wasm))["'`]/g,
  ];
  for (const re of patterns) {
    for (const m of code.matchAll(re)) {
      const spec = m[1];
      if (!spec || (/^[a-z@]/i.test(spec) && !spec.includes('/'))) continue;
      try {
        // Bundlers emit paths relative to the chunk or to the site root ("assets/x.js").
        out.add(new URL(spec, spec.startsWith('.') || spec.startsWith('/') ? base : new URL('/', base)).toString());
      } catch {
        // not a URL
      }
    }
  }
  return [...out];
}

/**
 * Direct asset mirroring: downloads HTML, scripts, styles and media from an authorized origin
 * and stores them with their original paths so the copy can be served again. Like real
 * mirroring tools it also tries `<script>.map` to recover original sources (stored separately,
 * never served as part of the clone).
 */
export const mirrorRunner: CloneRunner = {
  id: 'mirror',
  title: 'Direct asset mirroring (built-in, wget/HTTrack-style)',
  technique: 'asset-mirroring',
  requiresAi: false,
  async availability() {
    return { available: true };
  },
  async run(task: CloneTask): Promise<CloneAttempt> {
    const started = performance.now();
    const cpu0 = process.cpuUsage();
    const ledger = newLedger();
    const origin = new URL(task.targetUrl).origin;
    const root = task.outputDir;
    const mapsDir = path.join(task.workDir, 'recovered-source-maps');
    await fs.mkdir(root, { recursive: true });
    const seen = new Set<string>();
    const pageQueue: string[] = [new URL('/', task.targetUrl).toString()];
    const assetQueue: string[] = [];
    let pages = 0;
    let recoveredMaps = 0;
    const deadline = Date.now() + task.timeoutMs;
    const log: string[] = [];
    const opts = { maxRequests: task.maxRequests, timeoutMs: 15_000, maxBytes: 50 * 1024 * 1024 };

    const save = async (url: string, body: Buffer, isHtml: boolean): Promise<void> => {
      const file = localPath(root, new URL(url).pathname, isHtml);
      if (!file) return;
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, body);
    };

    while ((pageQueue.length || assetQueue.length) && Date.now() < deadline) {
      const isPage = pageQueue.length > 0;
      const url = (isPage ? pageQueue.shift() : assetQueue.shift()) as string;
      const key = url.split('#')[0] as string;
      if (seen.has(key)) continue;
      seen.add(key);
      if (new URL(key).origin !== origin) continue;
      if (isPage && pages >= task.maxPages) continue;
      const res = await guardedFetch(key, task.policy, ledger, opts);
      if (!res || res.status >= 400) {
        log.push(`${res?.status ?? 'ERR'} ${key}`);
        continue;
      }
      const isHtml = res.contentType.includes('text/html');
      await save(key, res.body, isHtml);
      log.push(`200 ${key}`);
      const text = res.body.toString('utf8');
      if (isHtml) {
        pages++;
        const found = discoverFromHtml(text, key);
        assetQueue.push(...found.assets);
        for (const p of found.pages) {
          const u = new URL(p);
          if (u.origin === origin && (!path.extname(u.pathname) || u.pathname.endsWith('.html'))) pageQueue.push(u.toString());
        }
      } else if (res.contentType.includes('css') || key.endsWith('.css')) {
        assetQueue.push(...discoverFromCss(text, key));
      } else if (res.contentType.includes('javascript') || /\.m?js$/.test(key)) {
        assetQueue.push(...discoverFromJs(text, key).filter((u) => ASSET_EXT.test(new URL(u).pathname)));
        const map = await guardedFetch(`${key}.map`, task.policy, ledger, opts);
        if (map && map.status === 200 && /^\s*\{/.test(map.body.subarray(0, 32).toString('utf8'))) {
          const dest = localPath(mapsDir, `${new URL(key).pathname}.map`, false);
          if (dest) {
            await fs.mkdir(path.dirname(dest), { recursive: true });
            await fs.writeFile(dest, map.body);
            recoveredMaps++;
          }
        }
      }
    }
    await fs.writeFile(task.logFile, `${log.join('\n')}\n`);
    const cpu = process.cpuUsage(cpu0);
    const timedOut = Date.now() >= deadline;
    return {
      status: timedOut ? 'timeout' : 'completed',
      durationMs: Math.round(performance.now() - started),
      cloneDir: root,
      ...(recoveredMaps ? { recoveredSourceDir: mapsDir } : {}),
      resources: { cpuUserMs: Math.round(cpu.user / 1000), cpuSystemMs: Math.round(cpu.system / 1000), maxRssBytes: process.memoryUsage().rss, source: 'process' },
      notes: [
        `${pages} page(s), ${seen.size} URL(s) visited, ${ledger.requests} request(s), ${ledger.blocked.length} blocked`,
        recoveredMaps ? `${recoveredMaps} source map(s) downloaded — original source recoverable` : 'no source maps downloadable',
      ],
    };
  },
};
