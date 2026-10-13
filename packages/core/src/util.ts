import { createHash } from 'node:crypto';
import picomatch from 'picomatch';

export function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function createMatcher(patterns: readonly string[]): (file: string) => boolean {
  if (patterns.length === 0) return () => false;
  const matchers = patterns.map((p) => picomatch(p, { dot: true }));
  return (file) => matchers.some((m) => m(file));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function pctChange(before: number, after: number): number | null {
  if (before === 0) return null;
  return ((after - before) / before) * 100;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? null);
}

export function stddev(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Attribute that marks the elements of the visible rights notice dcm adds to pages. */
export const RIGHTS_ATTR = 'data-dcm-rights';

/** File-name-safe form of a route ("/" becomes "home"). */
export function slug(route: string): string {
  return route === '/' ? 'home' : route.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-').slice(0, 60) || 'route';
}

/** A 0..1 ratio as a percentage with one decimal, or "n/a" when it is missing. */
export function pct(value: number | null | undefined): string {
  return value === null || value === undefined ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

/** Decodes the few HTML entities that appear in visible text (&nbsp; &quot; &#39; &apos; &amp;). */
export function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
