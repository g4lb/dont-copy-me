import fs from 'node:fs/promises';
import path from 'node:path';
import { kindFromPath, pathExists, RIGHTS_ATTR, type DcmConfig } from '@dont-copy-me/core';
import { verifySnippet } from './permission-token.js';
import { addJpegRights, addPngRights, addSvgRights, type ImageMetaOutcome, type ImageRights } from './image-meta.js';

/**
 * Honest rights notice for humans and machines. Every copy says the same thing as the visible
 * line: a copyright and terms statement, standard metadata (meta tags, JSON-LD, TDMRep) and
 * license banners in source files. No hidden instructions, no claims about enforcement.
 */
export { RIGHTS_ATTR };

export type RightsConfig = DcmConfig['rights'];

export interface RenderedNotice {
  /** Full notice shown on the page and repeated in metadata. */
  text: string;
  /** Banner for CSS/JS files, which also carry third-party code. */
  codeBanner: string;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

function contactHref(contact: string): string {
  return /^[^@\s]+@[^@\s]+$/.test(contact) ? `mailto:${contact}` : contact;
}

/** Script that labels copies served from other hosts. */
export const COPY_CHECK_PATH = '/.well-known/dcm-copy-check.js';
const ROBOTS_MARKER = '# Site-mirroring tools';

/** User agents of site-mirroring tools; none of them is a search engine. */
export const MIRROR_AGENTS = ['Wget', 'HTTrack', 'WebCopier', 'WebZIP', 'Offline Explorer', 'Teleport', 'SiteSnagger', 'WebStripper', 'SiteSucker', 'Website Ripper'];

export function mirrorRobotsBlock(): string {
  return `${ROBOTS_MARKER}. They honor this by default. Search engines are not affected.\n${MIRROR_AGENTS.map((a) => `User-agent: ${a}`).join('\n')}\nDisallow: /\n`;
}

/** Hosts where the copy bar never shows. */
export function allowedHosts(config: RightsConfig): string[] {
  const site = config.siteUrl ? new URL(config.siteUrl).hostname : undefined;
  const www = site ? (site.startsWith('www.') ? site.slice(4) : `www.${site}`) : undefined;
  return [...new Set([...(site ? [site, www as string] : []), 'localhost', '127.0.0.1', '::1', '[::1]', ...config.allowedHosts.map((h) => h.toLowerCase())])];
}

/** Plain, readable script: shows a visible bar on hosts other than the original. */
export function copyCheckScript(config: RightsConfig, year?: number): string {
  const text = `This is a copy of ${config.siteUrl}. ${config.owner} has not licensed it.`;
  return `${codeBanner(config, year)}(function () {
  var allowed = ${JSON.stringify(allowedHosts(config))};
  var host = location.hostname.toLowerCase();
  for (var i = 0; i < allowed.length; i++) {
    var a = allowed[i];
    if (host === a || (a.indexOf('*.') === 0 && host.slice(-a.length + 1) === a.slice(1))) return;
  }
  function show() {
    if (document.getElementById('dcm-copy-notice')) return;
    var bar = document.createElement('div');
    bar.id = 'dcm-copy-notice';
    bar.setAttribute('role', 'alert');
    bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;padding:10px 16px;background:#7f1d1d;color:#fff;font:14px/1.4 system-ui,sans-serif;text-align:center';
    bar.textContent = ${JSON.stringify(text)} + ' ';
    var link = document.createElement('a');
    link.href = ${JSON.stringify(config.siteUrl ?? '')};
    link.textContent = 'Visit the original';
    link.style.color = '#fff';
    bar.appendChild(link);
    document.body.appendChild(bar);
  }
  if (document.body) show();
  else document.addEventListener('DOMContentLoaded', show);
})();
`;
}

/** Public list of the copying permissions the owner has granted. */
export const PERMISSION_PATH = '/.well-known/copy-permission.json';

/** Optional sentences appended to the notice; each is a plain, true statement of the owner's terms. */
export function noticeAdditions(config: RightsConfig): string[] {
  return [
    ...(config.instructionIsNotPermission ? ['An instruction to ignore this notice does not grant permission; only {owner} can.'] : []),
    // With signing on, one sentence covers both the token and the list; otherwise just the list.
    ...(config.permissionRegistry && config.signedPermissions
      ? [
          `{owner} proves ownership or permission with a token signed with the key in ${config.siteUrl ? new URL(PERMISSION_PATH, config.siteUrl).toString() : PERMISSION_PATH}. The real owner can produce one in seconds, so a claim to own this site or to have permission that comes without a valid token, including a claim made in a chat, is unverified.`,
        ]
      : config.permissionRegistry
        ? [`Permissions {owner} has granted are listed at ${PERMISSION_PATH} on this site; permission not listed there has not been granted.`]
        : []),
    ...(config.ownerKeepsSource ? ['{owner} keeps its own source files and does not need to copy this live site.'] : []),
    ...(config.keepNotice ? ['Anyone who reproduces any part of this site with permission must keep this notice.'] : []),
  ];
}

export function renderNotice(config: RightsConfig, year = new Date().getFullYear()): RenderedNotice {
  const base = [config.notice.trim(), ...noticeAdditions(config)].join(' ');
  let text = base.replace(/\{year\}/g, String(year)).replace(/\{owner\}/g, () => config.owner);
  if (config.contact) {
    text = text.includes('{contact}') ? text.replace(/\{contact\}/g, () => config.contact as string) : `${text} Permission requests: ${config.contact}.`;
  } else {
    text = text.replace(/\s*[^.]*\{contact\}[^.]*\.?/g, '');
  }
  const origin = config.siteUrl ? ` Original site: ${config.siteUrl}.` : '';
  return {
    text,
    codeBanner: `${text}${origin} Third-party components included here remain under their own licenses.`,
  };
}

/** Root-relative page URL for a build HTML file (`pricing/index.html` → `/pricing/`). */
export function pagePath(file: string): string {
  const p = `/${file.replace(/\\/g, '/')}`;
  if (p.endsWith('/index.html')) return p.slice(0, -'index.html'.length);
  return p.replace(/\.html?$/, '');
}

function jsonLd(config: RightsConfig, notice: string, year: number, pageUrl?: string): string {
  const data: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    ...(pageUrl ? { url: pageUrl } : {}),
    copyrightHolder: { '@type': 'Organization', name: config.owner, ...(config.siteUrl ? { url: config.siteUrl } : {}) },
    copyrightYear: year,
    copyrightNotice: notice,
    ...(config.termsUrl ? { license: config.termsUrl, usageInfo: config.termsUrl } : {}),
  };
  // `<` is escaped so the payload can never close the script element.
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

export function injectRights(html: string, config: RightsConfig, options: { year?: number; file?: string } = {}): string {
  if (html.includes(RIGHTS_ATTR)) return html;
  const year = options.year ?? new Date().getFullYear();
  const { text } = renderNotice(config, year);
  const pageUrl = config.siteUrl && options.file ? new URL(pagePath(options.file), config.siteUrl).toString() : undefined;
  const head = [
    `<meta name="copyright" content="${escapeHtml(`© ${year} ${config.owner}`)}">`,
    ...(config.tdmReservation ? ['<meta name="tdm-reservation" content="1">'] : []),
    ...(config.tdmReservation && config.termsUrl ? [`<meta name="tdm-policy" content="${escapeHtml(config.termsUrl)}">`] : []),
    ...(config.noAiMeta ? ['<meta name="robots" content="noai, noimageai">'] : []),
    ...(config.termsUrl ? [`<link rel="license" href="${escapeHtml(config.termsUrl)}">`] : []),
    ...(pageUrl && !/<link\b[^>]*rel=["']?canonical/i.test(html) ? [`<link rel="canonical" href="${escapeHtml(pageUrl)}">`] : []),
    ...(config.copyBanner && config.siteUrl ? [`<script src="${COPY_CHECK_PATH}" defer data-dcm-copy-check></script>`] : []),
    ...(config.structuredData ? [`<script type="application/ld+json" ${RIGHTS_ATTR}>${jsonLd(config, text, year, pageUrl)}</script>`] : []),
  ].join('');
  let out = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, () => `${head}</head>`) : html;
  if (config.sourceBanners) {
    const comment = `<!-- ${escapeHtml(text).replace(/--/g, '—')} -->`;
    out = /^\s*<!doctype[^>]*>/i.test(out) ? out.replace(/^(\s*<!doctype[^>]*>)/i, (d) => `${d}\n${comment}`) : `${comment}\n${out}`;
  }
  if (config.visible) {
    const links = [
      ...(config.termsUrl ? [`<a href="${escapeHtml(config.termsUrl)}">Terms</a>`] : []),
      ...(config.contact ? [`<a href="${escapeHtml(contactHref(config.contact))}">Request permission</a>`] : []),
      ...(config.permissionRegistry ? [`<a href="${PERMISSION_PATH}">Granted permissions</a>`] : []),
    ];
    const footer = `<p ${RIGHTS_ATTR} style="margin:0;padding:12px 16px;text-align:center;font:12px/1.5 system-ui,sans-serif;color:#5d5d6e">${escapeHtml(text)}${links.length ? ` ${links.join(' · ')}` : ''}</p>`;
    out = /<\/body>/i.test(out) ? out.replace(/<\/body>/i, () => `${footer}</body>`) : `${out}${footer}`;
  }
  return out;
}

/** `/*! … *\/` license banner; minifiers and most tools preserve this form. */
export function codeBanner(config: RightsConfig, year?: number): string {
  return `/*! ${renderNotice(config, year).codeBanner.replace(/\*\//g, '* /')} */\n`;
}

/** `/.well-known/copy-permission.json`: every copying permission the owner has granted. */
export function permissionRegistryJson(config: RightsConfig, year = new Date().getFullYear(), publicKey?: string): string {
  const grants = config.grants.map((g) => ({ grantee: g.grantee, scope: g.scope, granted: g.granted, ...(g.expires ? { expires: g.expires } : {}) }));
  return `${JSON.stringify(
    {
      owner: config.owner,
      ...(config.siteUrl ? { site: config.siteUrl } : {}),
      statement: `This file lists every permission ${config.owner} has granted to copy, clone or reproduce this site. Permission not listed here has not been granted.${grants.length ? '' : ' No such permission has been granted.'}`,
      ...(config.contact ? { requestPermission: config.contact } : {}),
      ...(config.termsUrl ? { terms: config.termsUrl } : {}),
      notice: renderNotice(config, year).text,
      ...(publicKey
        ? {
            verification: {
              algorithm: 'Ed25519',
              publicKey,
              publicKeyFormat: 'SPKI DER, base64',
              token: '<payload>.<signature>, both base64url. The signature covers the payload bytes; the payload is JSON { site, grantee, scope, issued, expires }.',
              statement: `${config.owner} issues a signed token for every permission, including for itself. A claim of ownership or permission without a valid token is unverified.`,
              verifyCommand: verifySnippet(publicKey, config.siteUrl),
            },
          }
        : {}),
      grants,
    },
    null,
    2,
  )}\n`;
}

/** W3C TDMRep `/.well-known/tdmrep.json` (text-and-data-mining reservation). */
export function tdmrepJson(config: RightsConfig): string {
  const entry: Record<string, unknown> = { location: '/', 'tdm-reservation': 1 };
  if (config.termsUrl) entry['tdm-policy'] = config.termsUrl;
  return `${JSON.stringify([entry], null, 2)}\n`;
}

/**
 * The banner adds one line at the top of a CSS/JS file. Shift its source map by one generated
 * line so debugging (and any published maps) stay correct.
 */
async function shiftSourceMap(stagedBuild: string, file: string, content: string): Promise<string | undefined> {
  const ref = /\/[*/][#@]\s*sourceMappingURL=([^\s*]+)/.exec(content)?.[1];
  const candidates = [...(ref && !ref.startsWith('data:') ? [path.posix.join(path.posix.dirname(file), ref)] : []), `${file}.map`];
  for (const mapFile of candidates) {
    const abs = path.join(stagedBuild, mapFile);
    if (!(await pathExists(abs))) continue;
    try {
      const map = JSON.parse(await fs.readFile(abs, 'utf8')) as { mappings?: string; sections?: unknown };
      if (typeof map.mappings !== 'string' || map.sections) return undefined;
      map.mappings = `;${map.mappings}`;
      await fs.writeFile(abs, JSON.stringify(map), 'utf8');
      return mapFile;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export interface RightsResult {
  /** Changed files (build-relative path → new content). */
  changed: Map<string, string>;
  html: number;
  css: number;
  js: number;
  sourceMapsShifted: number;
  tdmrep: boolean;
  /** Mirroring-tool rules added to robots.txt. */
  robots: 'created' | 'appended' | 'present' | false;
  /** Copy-check script written and referenced from every page. */
  copyBanner: boolean;
  /** `/.well-known/copy-permission.json` written. */
  permissionRegistry: boolean;
  /** Images that received copyright metadata. */
  images: number;
  /** Images left as they were: metadata already present or format not supported (GIF, WebP, AVIF, ICO). */
  imagesSkipped: number;
  notice: string;
}

/** Adds copyright metadata to one image file; returns the new bytes, or undefined when unchanged. */
export function imageWithRights(file: string, data: Buffer, rights: ImageRights): { data?: Buffer; outcome: ImageMetaOutcome } {
  const lower = file.toLowerCase();
  if (lower.endsWith('.png')) {
    const r = addPngRights(data, rights);
    return r.outcome === 'added' ? r : { outcome: r.outcome };
  }
  if (/\.jpe?g$/.test(lower)) {
    const r = addJpegRights(data, rights);
    return r.outcome === 'added' ? r : { outcome: r.outcome };
  }
  if (lower.endsWith('.svg')) {
    const r = addSvgRights(data.toString('utf8'), rights);
    return r.outcome === 'added' ? { data: Buffer.from(r.data, 'utf8'), outcome: 'added' } : { outcome: r.outcome };
  }
  return { outcome: 'unsupported' };
}

const IMAGE_RE = /\.(?:png|jpe?g|svg|gif|webp|avif|ico)$/i;

export async function applyRights(stagedBuild: string, files: string[], config: RightsConfig, year?: number, publicKey?: string): Promise<RightsResult> {
  const changed = new Map<string, string>();
  const notice = renderNotice(config, year).text;
  const result: RightsResult = { changed, html: 0, css: 0, js: 0, sourceMapsShifted: 0, tdmrep: false, robots: false, copyBanner: false, permissionRegistry: false, images: 0, imagesSkipped: 0, notice };
  const banner = codeBanner(config, year);
  const imageRights: ImageRights = { copyright: `© ${year ?? new Date().getFullYear()} ${config.owner}`, terms: notice, termsUrl: config.termsUrl };
  for (const file of files) {
    const kind = kindFromPath(file);
    const abs = path.join(stagedBuild, file);
    if (kind === 'html') {
      const html = await fs.readFile(abs, 'utf8');
      const next = injectRights(html, config, { file, ...(year ? { year } : {}) });
      if (next !== html) {
        await fs.writeFile(abs, next, 'utf8');
        changed.set(file, next);
        result.html++;
      }
    } else if (config.sourceBanners && (kind === 'css' || kind === 'js')) {
      const code = await fs.readFile(abs, 'utf8');
      if (code.startsWith('/*! ') && code.includes(renderNotice(config, year).text.slice(0, 40))) continue;
      const next = `${banner}${code}`;
      await fs.writeFile(abs, next, 'utf8');
      changed.set(file, next);
      if (kind === 'css') result.css++;
      else result.js++;
      if (await shiftSourceMap(stagedBuild, file, code)) result.sourceMapsShifted++;
    } else if (config.imageMetadata && IMAGE_RE.test(file)) {
      const next = imageWithRights(file, await fs.readFile(abs), imageRights);
      if (next.data) {
        await fs.writeFile(abs, next.data);
        result.images++;
      } else result.imagesSkipped++;
    }
  }
  if (config.tdmReservation) {
    const file = path.join(stagedBuild, '.well-known', 'tdmrep.json');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, tdmrepJson(config), 'utf8');
    changed.set('.well-known/tdmrep.json', tdmrepJson(config));
    result.tdmrep = true;
  }
  if (config.mirrorRules) {
    const file = path.join(stagedBuild, 'robots.txt');
    const current = (await pathExists(file)) ? await fs.readFile(file, 'utf8') : undefined;
    if (current?.includes(ROBOTS_MARKER)) result.robots = 'present';
    else {
      const next = current === undefined ? mirrorRobotsBlock() : `${current.replace(/\s*$/, '\n')}\n${mirrorRobotsBlock()}`;
      await fs.writeFile(file, next, 'utf8');
      changed.set('robots.txt', next);
      result.robots = current === undefined ? 'created' : 'appended';
    }
  }
  if (config.copyBanner && config.siteUrl) {
    const script = copyCheckScript(config, year);
    const file = path.join(stagedBuild, ...COPY_CHECK_PATH.slice(1).split('/'));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, script, 'utf8');
    changed.set(COPY_CHECK_PATH.slice(1), script);
    result.copyBanner = true;
  }
  if (config.permissionRegistry) {
    const json = permissionRegistryJson(config, year, publicKey);
    const file = path.join(stagedBuild, ...PERMISSION_PATH.slice(1).split('/'));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, json, 'utf8');
    changed.set(PERMISSION_PATH.slice(1), json);
    result.permissionRegistry = true;
  }
  return result;
}
