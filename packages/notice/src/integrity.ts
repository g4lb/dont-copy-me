import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { kindFromPath } from '@dont-copy-me/core';

const TAG_RE = /<(script|link)\b[^>]*>/gi;
const ATTR_RE = (name: string): RegExp => new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i');

function attr(tag: string, name: string): string | undefined {
  const m = ATTR_RE(name).exec(tag);
  return m ? (m[2] ?? m[3]) : undefined;
}

function isLocalRef(ref: string): boolean {
  return !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref);
}

export type UrlMapper = (urlPath: string) => string;

const defaultMapper: UrlMapper = (urlPath) => urlPath.replace(/^\//, '');

function resolveRef(fromFile: string, ref: string, mapUrl: UrlMapper = defaultMapper): string {
  const clean = ref.split(/[?#]/)[0] ?? ref;
  if (clean.startsWith('/')) return mapUrl(clean);
  return path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), clean));
}

/**
 * Recomputes Subresource Integrity hashes in HTML for every file that gained a license banner, so
 * builds that use SRI keep loading. Returns the number of attributes updated.
 */
export async function updateIntegrityAttributes(
  buildDir: string,
  files: string[],
  transformed: Map<string, string>,
  mapUrl: UrlMapper = defaultMapper,
): Promise<number> {
  if (transformed.size === 0) return 0;
  let updates = 0;
  for (const file of files.filter((f) => kindFromPath(f) === 'html')) {
    const abs = path.join(buildDir, file);
    const html = await fs.readFile(abs, 'utf8');
    const next = html.replace(TAG_RE, (tag) => {
      const integrity = attr(tag, 'integrity');
      const ref = attr(tag, 'src') ?? attr(tag, 'href');
      if (!integrity || !ref || !isLocalRef(ref)) return tag;
      const target = resolveRef(file, ref, mapUrl);
      const code = transformed.get(target);
      if (code === undefined) return tag;
      const algo = /^(sha256|sha384|sha512)-/.exec(integrity)?.[1] ?? 'sha384';
      const digest = createHash(algo).update(code).digest('base64');
      updates++;
      return tag.replace(integrity, `${algo}-${digest}`);
    });
    if (next !== html) await fs.writeFile(abs, next, 'utf8');
  }
  return updates;
}

/** Verifies that every local script and stylesheet referenced from HTML still resolves to a file. */
export async function checkReferences(buildDir: string, files: string[], mapUrl: UrlMapper = defaultMapper): Promise<string[]> {
  const present = new Set(files);
  const broken: string[] = [];
  for (const file of files.filter((f) => kindFromPath(f) === 'html')) {
    const html = await fs.readFile(path.join(buildDir, file), 'utf8');
    for (const match of html.matchAll(TAG_RE)) {
      const tag = match[0];
      const ref = attr(tag, 'src') ?? attr(tag, 'href');
      if (!ref || !isLocalRef(ref)) continue;
      const target = resolveRef(file, ref, mapUrl);
      // Only assert on build-owned asset types; HTML links to routes are not files.
      if (!['js', 'css'].includes(kindFromPath(target))) continue;
      if (!present.has(target)) broken.push(`${file} → ${ref}`);
    }
  }
  return broken;
}
