import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import { DcmError, decodeEntities, ExitCode, nowIso, pathExists, readReport, sha256, walkFiles, type Logger, type ProjectContext } from '@dont-copy-me/core';
import { RIGHTS_ATTR, renderNotice, type ProtectManifest } from '@dont-copy-me/notice';
import { newStableContext, settle } from './capture.js';
import { startTarget } from './targets.js';

/**
 * Evidence kit for acting on a copy after it appears: a dated SHA-256 manifest of the published
 * build, distinctive passages to search the web for, and a takedown draft that cites the notice.
 * Nothing leaves the machine unless `wayback` is set.
 */
export interface EvidenceOptions {
  project: ProjectContext;
  logger: Logger;
  /** Build to record (default: the output with the notice, else the input build). */
  dir?: string;
  /** Render routes in Chromium to extract visible text (default true). */
  render?: boolean;
  /** Ask the Internet Archive to snapshot `rights.siteUrl` (sends that URL to web.archive.org). */
  wayback?: boolean;
  /** Override for tests. */
  fetchImpl?: typeof fetch;
}

export interface EvidenceFile {
  path: string;
  sha256: string;
  bytes: number;
}

export interface EvidenceManifest {
  tool: 'dont-copy-me';
  kind: 'evidence';
  createdAt: string;
  owner: string;
  siteUrl: string | null;
  contact: string | null;
  termsUrl: string | null;
  notice: string;
  placements: string[];
  source: string;
  rootHash: string;
  files: EvidenceFile[];
  routes: string[];
  phrases: string[];
  wayback?: { requested: string; status: number | null; snapshot: string | null; error?: string };
}

export interface EvidenceResult {
  dir: string;
  manifest: EvidenceManifest;
  /** SHA-256 of manifest.json: record it somewhere dated (email, commit, timestamp service). */
  manifestSha256: string;
}

const MIN_LEN = 30;
const MAX_LEN = 220;
const MAX_PHRASES = 15;

/** Splits visible text into sentences and keeps long, specific ones that make good search queries. */
export function distinctivePhrases(texts: string[], exclude: string[] = [], max = MAX_PHRASES): string[] {
  const normalized = (s: string): string => s.replace(/\s+/g, ' ').trim();
  const skip = exclude.map((e) => normalized(e).toLowerCase()).filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const text of texts) {
    for (const raw of text.split(/\n+|(?<=[.!?])\s+/)) {
      const s = normalized(raw);
      const key = s.toLowerCase();
      if (s.length < MIN_LEN || s.length > MAX_LEN || s.split(' ').length < 5 || seen.has(key)) continue;
      if (skip.some((e) => e.includes(key) || key.includes(e))) continue;
      // Prices, counters and other numbers change and make poor search queries.
      if ((s.match(/[\d$€£%#]/g)?.length ?? 0) / s.length > 0.1) continue;
      seen.add(key);
      out.push(s);
    }
  }
  return out.sort((a, b) => b.length - a.length).slice(0, max);
}

function textFromHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(new RegExp(`<p\\b[^>]*${RIGHTS_ATTR}[\\s\\S]*?</p>`, 'gi'), ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(?:br|p|div|li|h[1-6]|section|article|header|footer|tr)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  );
}

async function renderedTexts(project: ProjectContext, dir: string, routes: string[], logger: Logger): Promise<string[]> {
  const target = await startTarget(project, 'evidence', dir);
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: project.config.browser.headless, ...(project.config.browser.channel ? { channel: project.config.browser.channel } : {}) });
    const viewport = project.config.verify.viewports[0];
    if (!viewport) return [];
    const context = await newStableContext(browser, viewport, project.config.browser);
    const texts: string[] = [];
    for (const route of routes) {
      const page = await context.newPage();
      try {
        await page.goto(new URL(route, target.url).toString(), { waitUntil: 'load', timeout: project.config.verify.navigationTimeoutMs });
        await settle(page);
        texts.push(
          await page.evaluate((attr) => {
            for (const el of document.querySelectorAll(`[${attr}]`)) el.remove();
            return document.body.innerText;
          }, RIGHTS_ATTR),
        );
      } catch (error) {
        logger.warn(`Could not render ${route}: ${(error as Error).message.split('\n')[0]}`);
      } finally {
        await page.close();
      }
    }
    await context.close();
    return texts;
  } finally {
    await browser?.close();
    await target.close();
  }
}

function placementsFrom(manifest: ProtectManifest | undefined, rights: ProjectContext['config']['rights']): string[] {
  const r = manifest?.rights ?? { ...rights, images: 0 };
  return [
    ...(r.visible ? ['a visible line at the end of every page, with links to the terms and to request permission'] : []),
    ...(r.sourceBanners ? ['an HTML comment at the top of every page', 'a license banner at the top of every CSS and JavaScript file'] : []),
    'a copyright meta tag',
    ...(r.structuredData ? ['schema.org structured data (copyrightHolder, copyrightNotice)'] : []),
    ...(r.tdmReservation ? ['a W3C TDMRep text-and-data-mining reservation (meta tags and /.well-known/tdmrep.json)'] : []),
    ...(r.noAiMeta ? ['a robots "noai, noimageai" meta tag'] : []),
    ...('permissionRegistry' in r && r.permissionRegistry ? ['a public list of granted permissions at /.well-known/copy-permission.json'] : []),
    ...(rights.signedPermissions && rights.permissionRegistry ? ['a statement that ownership or permission is proven only with a token signed with the published key'] : []),
    ...('images' in r && r.images ? ['copyright metadata embedded in the site images'] : []),
  ];
}

export function takedownDraft(m: EvidenceManifest, manifestSha256: string): string {
  const site = m.siteUrl ?? '[address of your site]';
  const list = (items: string[]): string => items.map((i) => `   - ${i}`).join('\n');
  return `# Copyright infringement notice (draft)

> Generated by Don't Copy Me on ${m.createdAt}. **Not legal advice.** Complete every [bracket],
> remove what does not apply, and send it to the host's or platform's abuse / DMCA contact
> (search "<host name> DMCA" or look the domain up with \`whois\`).

**To:** [hosting provider or platform, designated copyright agent]
**From:** ${m.owner}${m.contact ? `, ${m.contact}` : ''}
**Date:** [date]

1. **Original work.** The website at ${site}, including its design, text, source code and images,
   owned by ${m.owner}.

2. **Infringing material.** [URL(s) of the copy]

3. **Prior publication.** On ${m.createdAt}, ${m.owner} recorded a SHA-256 manifest of the
   published site: ${m.files.length} files, root hash \`${m.rootHash}\`, manifest hash
   \`${manifestSha256}\`.${m.wayback?.snapshot ? `\n   Internet Archive snapshot: ${m.wayback.snapshot}.` : ' [Add an archived snapshot URL if you have one.]'}

4. **Notice shown to the copier.** Every page of the original states:

   > ${m.notice}

   The same statement appears in:
${list(m.placements)}

   [The copy keeps / removed this notice.]

5. **Matching content.** These passages appear in the original and in the copy:
   [paste the matching lines from phrases.txt, and add screenshots side by side]

6. I have a good faith belief that use of the material in the manner complained of is not
   authorized by the copyright owner, its agent, or the law.

7. The information in this notification is accurate, and under penalty of perjury, I am authorized
   to act on behalf of the owner of an exclusive right that is allegedly infringed.

**Signature:** [full name, title]

---

## How to use this kit

1. **Date the evidence now.** Keep \`manifest.json\` and record its hash \`${manifestSha256}\`
   somewhere with an independent date: email it to yourself, commit it to a repository, or
   timestamp it (for example \`ots stamp manifest.json\` with OpenTimestamps).
2. **Look for copies.** Search for the quoted passages in \`phrases.txt\` in a search engine, and run a
   reverse image search on your key images.
3. **Check a suspected copy.** Look for the notice text, the license banner at the top of its CSS/JS
   files, and the copyright fields in its images (\`exiftool image.png\`).
4. **Act.** Fill in this draft and send it to the host. Keep copies of everything you send.
`;
}

export async function collectEvidence(options: EvidenceOptions): Promise<EvidenceResult> {
  const { project, logger } = options;
  const rights = project.config.rights;
  const source = options.dir ? path.resolve(project.root, options.dir) : (await pathExists(project.outputDir)) ? project.outputDir : project.inputDir;
  if (!(await pathExists(source))) {
    throw new DcmError('E_NO_BUILD', `Nothing to record: ${path.relative(project.root, source) || '.'} does not exist`, {
      hint: 'Run your production build and `dcm protect` first, or pass --dir.',
      exitCode: ExitCode.Config,
    });
  }
  const files: EvidenceFile[] = [];
  for (const file of await walkFiles(source)) {
    const data = await fs.readFile(path.join(source, file));
    files.push({ path: file.replace(/\\/g, '/'), sha256: sha256(data), bytes: data.length });
  }
  if (files.length === 0) throw new DcmError('E_EMPTY_BUILD', `${source} is empty`, { exitCode: ExitCode.Config });
  const rootHash = sha256(files.map((f) => `${f.path}:${f.sha256}`).join('\n'));

  const protect = await readReport<ProtectManifest>(project.reportsDir, 'protect');
  const notice = protect?.rights.notice ?? renderNotice(rights).text;
  const routes = [...new Set(project.config.verify.routes)];

  let texts: string[] = [];
  if (options.render !== false) {
    try {
      texts = await renderedTexts(project, source, routes, logger);
    } catch (error) {
      logger.warn(`Rendering failed, using the HTML files only: ${(error as Error).message.split('\n')[0]}`);
    }
  }
  if (texts.every((t) => t.trim() === '')) {
    texts = [];
    for (const f of files.filter((x) => /\.html?$/i.test(x.path))) texts.push(textFromHtml(await fs.readFile(path.join(source, f.path), 'utf8')));
  }
  const phrases = distinctivePhrases(texts, [notice]);

  const manifest: EvidenceManifest = {
    tool: 'dont-copy-me',
    kind: 'evidence',
    createdAt: nowIso(),
    owner: rights.owner,
    siteUrl: rights.siteUrl ?? null,
    contact: rights.contact ?? null,
    termsUrl: rights.termsUrl ?? null,
    notice,
    placements: placementsFrom(protect, rights),
    source: path.relative(project.root, source) || '.',
    rootHash,
    files,
    routes,
    phrases,
  };

  if (options.wayback) {
    if (!rights.siteUrl) {
      throw new DcmError('E_NO_SITE_URL', '--wayback needs rights.siteUrl', { hint: 'Set rights.siteUrl to your public site.', exitCode: ExitCode.Usage });
    }
    const requested = `https://web.archive.org/save/${rights.siteUrl}`;
    try {
      const res = await (options.fetchImpl ?? fetch)(requested, { redirect: 'follow', signal: AbortSignal.timeout(120_000) });
      const loc = res.headers.get('content-location');
      const snapshot = loc ? `https://web.archive.org${loc}` : res.url.includes('/web/') ? res.url : null;
      manifest.wayback = { requested, status: res.status, snapshot };
    } catch (error) {
      manifest.wayback = { requested, status: null, snapshot: null, error: (error as Error).message };
    }
  }

  const dir = path.join(project.dcmDir, 'evidence', manifest.createdAt.replace(/[:.]/g, '-'));
  await fs.mkdir(dir, { recursive: true });
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
  const manifestSha256 = sha256(manifestJson);
  await fs.writeFile(path.join(dir, 'manifest.json'), manifestJson, 'utf8');
  await fs.writeFile(
    path.join(dir, 'phrases.txt'),
    `# Distinctive passages from ${manifest.siteUrl ?? manifest.source}. Search for them in quotes to find copies.\n${phrases.map((p) => `"${p}"`).join('\n')}\n`,
    'utf8',
  );
  await fs.writeFile(path.join(dir, 'takedown.md'), takedownDraft(manifest, manifestSha256), 'utf8');
  return { dir, manifest, manifestSha256 };
}
