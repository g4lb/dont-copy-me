import fs from 'node:fs/promises';
import path from 'node:path';
import {
  CONFIG_FILES,
  DcmError,
  ExitCode,
  detectFramework,
  parseHttpUrl,
  pathExists,
} from '@dont-copy-me/core';
import { ADAPTERS, makeLogger, type GlobalOptions } from '../context.js';

export interface InitOptions {
  force?: boolean;
  dryRun?: boolean;
  framework?: string;
  owner?: string;
  terms?: string;
  contact?: string;
  site?: string;
  gitignore?: boolean;
}

const q = (v: string): string => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

export function renderConfig(input: {
  framework: string;
  input: string;
  output: string;
  owner?: string;
  termsUrl?: string;
  contact?: string;
  siteUrl?: string;
}): string {
  const opt = (key: string, value: string | undefined, example: string): string => (value ? `    ${key}: ${q(value)},` : `    // ${key}: ${q(example)},`);
  return `import { defineConfig } from 'dont-copy-me';

/**
 * Don't Copy Me configuration. Reference: docs/configuration.md in the dont-copy-me repository.
 *
 * Reminder: a public website cannot be made uncopyable. The rights notice states your terms to
 * people and AI agents; it does not technically prevent copying.
 */
export default defineConfig({
  // 'auto' | 'vite' | 'static'
  framework: ${q(input.framework)},

  // Production build to read, and the separate directory that receives the copy with the notice.
  input: ${q(input.input)},
  output: ${q(input.output)},

  rights: {
    // Your legal name. The notice says "the site owner" until you set it.
    owner: ${q(input.owner ?? 'the site owner')},
${opt('termsUrl', input.termsUrl, 'https://example.com/terms')}
${opt('contact', input.contact, 'legal@example.com')}
${opt('siteUrl', input.siteUrl, 'https://example.com')}
    // The default notice text is in docs/configuration.md; override it with \`notice\`.
    // Signed permission tokens are on: \`dcm protect\` creates a private key in .dcm/ on first run
    // (back it up, never deploy it). Give someone permission with \`dcm grant --to <name> --scope <what>\`.
  },

  verify: {
    routes: ['/'],
    crawl: true,
  },

  waf: {
    // Opt-in. \`dcm shield\` only writes templates to .dcm/shield; it never changes live infrastructure.
    enabled: false,
  },
});
`;
}

export async function runInit(global: GlobalOptions, options: InitOptions): Promise<number> {
  const logger = makeLogger(global);
  const root = path.resolve(global.cwd ?? process.cwd());
  for (const name of CONFIG_FILES) {
    const existing = path.join(root, name);
    if ((await pathExists(existing)) && !options.force) {
      throw new DcmError('E_CONFIG_EXISTS', `${name} already exists`, {
        hint: 'Use --force to overwrite it, or edit the existing file.',
        exitCode: ExitCode.Usage,
      });
    }
  }
  const detected = await detectFramework(root, ADAPTERS);
  const adapter = options.framework ? ADAPTERS.find((a) => a.name === options.framework) : detected?.adapter;
  if (options.framework && !adapter) {
    throw new DcmError('E_FRAMEWORK', `Unknown framework "${options.framework}"`, { hint: 'Use vite or static.', exitCode: ExitCode.Usage });
  }
  const chosen = adapter ?? ADAPTERS.find((a) => a.name === 'static');
  if (!chosen) throw new Error('internal: static adapter missing');
  const termsUrl = options.terms ? parseHttpUrl(options.terms, '--terms').toString() : undefined;
  const siteUrl = options.site ? parseHttpUrl(options.site, '--site').toString() : undefined;
  const content = renderConfig({
    framework: options.framework ?? (detected ? chosen.name : 'auto'),
    input: chosen.defaultInput,
    output: chosen.defaultOutput,
    ...(options.owner ? { owner: options.owner } : {}),
    ...(termsUrl ? { termsUrl } : {}),
    ...(options.contact ? { contact: options.contact } : {}),
    ...(siteUrl ? { siteUrl } : {}),
  });
  const target = path.join(root, 'dcm.config.ts');
  if (detected) logger.info(`Detected ${detected.adapter.displayName} (${detected.evidence.join(', ')})`);
  else logger.warn('No framework detected; using the static adapter.');

  if (options.dryRun) {
    logger.info(`[dry-run] would write ${path.relative(root, target)}:`);
    process.stdout.write(content);
  } else {
    const tmp = `${target}.${process.pid}.tmp`;
    await fs.writeFile(tmp, content, { encoding: 'utf8', flag: 'wx' });
    await fs.rename(tmp, target);
    logger.success(`Created ${path.relative(root, target)}`);
  }

  const gitignore = path.join(root, '.gitignore');
  const ignoreLines = ['.dcm/', chosen.defaultOutput.replace(/\/?$/, '/')];
  const current = (await pathExists(gitignore)) ? await fs.readFile(gitignore, 'utf8') : '';
  const missing = ignoreLines.filter((line) => !current.split(/\r?\n/).includes(line));
  if (missing.length > 0) {
    if (options.gitignore && !options.dryRun) {
      await fs.appendFile(gitignore, `${current.endsWith('\n') || current === '' ? '' : '\n'}# Don't Copy Me\n${missing.join('\n')}\n`);
      logger.success(`Added ${missing.join(', ')} to .gitignore`);
    } else {
      logger.info(`Recommended: add ${missing.join(', ')} to .gitignore (or re-run with --gitignore).`);
    }
  }
  logger.info('Next: build your app, then run `dcm protect` and `dcm verify`.');
  return ExitCode.Ok;
}
