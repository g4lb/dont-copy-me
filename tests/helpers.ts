import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createMemoryLogger, parseConfig, resolveProject, sha256, staticAdapter, walkFiles, type DcmConfigInput, type ProjectContext } from '@dont-copy-me/core';
import { viteAdapter } from '@dont-copy-me/framework-vite';

export const ADAPTERS = [viteAdapter, staticAdapter];

export async function tempDir(prefix = 'dcm-test-'): Promise<string> {
  return fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
}

export async function writeTree(root: string, files: Record<string, string | Buffer>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
  }
}

export async function treeHash(dir: string): Promise<string> {
  const files = await walkFiles(dir);
  const parts: string[] = [];
  for (const f of files) parts.push(`${f}:${sha256(await fs.readFile(path.join(dir, f)))}`);
  return sha256(parts.join('\n'));
}

export async function makeProject(root: string, config: DcmConfigInput): Promise<ProjectContext> {
  const parsed = parseConfig(config);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return resolveProject(root, parsed.config, ADAPTERS);
}

export const logger = (): ReturnType<typeof createMemoryLogger> => createMemoryLogger('debug');

export const RIGHTS = { owner: 'Lumen Analytics', termsUrl: 'https://lumen.example/terms', contact: 'legal@lumen.example', siteUrl: 'https://lumen.example' };

export const APP_JS = `export function quote(seats){return seats*29}\n//# sourceMappingURL=index-aaa111.js.map\n`;
