/**
 * Contract between framework integrations and the notice pipeline. Adapters only describe a
 * build (where it is, how to serve it); they never change it.
 */
export type AssetKind = 'js' | 'css' | 'html' | 'sourcemap' | 'asset' | 'other';

export interface DetectResult {
  confidence: number;
  evidence: string[];
}

export interface FrameworkAdapter {
  readonly name: 'vite' | 'static';
  readonly displayName: string;
  /** Default build directory relative to the project root. */
  readonly defaultInput: string;
  readonly defaultOutput: string;
  /** How the verifier should run builds: static file server or a framework server. */
  readonly serveMode: 'static' | 'server';
  /** Known limitations surfaced in every report produced with this adapter. */
  readonly limitations: readonly string[];
  /**
   * Maps a root-relative URL path used in HTML (e.g. `/assets/x.js`) to a build-relative
   * file path (`assets/x.js`). Defaults to stripping the leading slash.
   */
  urlToBuildPath?(urlPath: string): string;
  /** Globs never copied into the protected output (for example framework caches). */
  readonly copyIgnore?: readonly string[];
  detect(projectRoot: string): Promise<DetectResult | null>;
}

export function kindFromPath(file: string): AssetKind {
  const lower = file.toLowerCase();
  if (lower.endsWith('.map')) return 'sourcemap';
  if (/\.(m|c)?js$/.test(lower)) return 'js';
  if (lower.endsWith('.css')) return 'css';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (/\.(png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot|mp4|webm|mp3|wav|json|txt|xml|webmanifest)$/.test(lower)) {
    return 'asset';
  }
  return 'other';
}
