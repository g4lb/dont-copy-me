import { Command, InvalidArgumentError, Option } from 'commander';
import { DcmError, ExitCode, isDcmError, type LogLevel } from '@dont-copy-me/core';
import type { GlobalOptions } from './context.js';
import { paint } from './format.js';
import { VERSION } from './version.js';

/** Command implementations, injectable so argument parsing can be tested without side effects. */
export interface Handlers {
  init(global: GlobalOptions, options: Record<string, unknown>): Promise<number>;
  protect(global: GlobalOptions, options: Record<string, unknown>): Promise<number>;
  rollback(global: GlobalOptions): Promise<number>;
  verify(global: GlobalOptions, options: Record<string, unknown>): Promise<number>;
  benchmark(global: GlobalOptions, options: Record<string, unknown>): Promise<number>;
  report(global: GlobalOptions, options: Record<string, unknown>): Promise<number>;
  status(global: GlobalOptions): Promise<number>;
  shield(global: GlobalOptions, options: Record<string, unknown>): Promise<number>;
  evidence(global: GlobalOptions, options: Record<string, unknown>): Promise<number>;
  grant(global: GlobalOptions, options: Record<string, unknown>): Promise<number>;
}

function positiveInt(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new InvalidArgumentError('must be a positive integer');
  return n;
}

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

export interface ProgramResult {
  exitCode: number;
}

export function createProgram(handlers: Handlers, result: ProgramResult = { exitCode: 0 }): Command {
  const program = new Command();
  program
    .name('dcm')
    .description("Don't Copy Me — an honest rights notice for people and AI agents.\nA public website cannot be made uncopyable; dcm states your terms where copiers look and measures how agents respond.")
    .version(VERSION, '-v, --version')
    .option('-C, --cwd <dir>', 'project directory (default: current directory)')
    .option('-c, --config <file>', 'configuration file (default: dcm.config.ts)')
    .option('--json', 'print machine-readable JSON to stdout')
    .addOption(new Option('--log-level <level>', 'log verbosity').choices(['silent', 'error', 'warn', 'info', 'debug']))
    .option('-q, --quiet', 'only print errors')
    .option('--no-color', 'disable colored output')
    .showHelpAfterError('(run with --help for usage)')
    .exitOverride();

  const globals = (): GlobalOptions => {
    const o = program.opts<{ cwd?: string; config?: string; json?: boolean; logLevel?: LogLevel; quiet?: boolean; color?: boolean }>();
    return {
      ...(o.cwd ? { cwd: o.cwd } : {}),
      ...(o.config ? { config: o.config } : {}),
      ...(o.json ? { json: true } : {}),
      ...(o.logLevel ? { logLevel: o.logLevel } : {}),
      ...(o.quiet ? { quiet: true } : {}),
      ...(o.color === false ? { color: false } : {}),
    };
  };
  const run =
    (fn: (opts: Record<string, unknown>) => Promise<number>) =>
    async (opts: Record<string, unknown>): Promise<void> => {
      result.exitCode = await fn(opts);
    };

  program
    .command('init')
    .description('create dcm.config.ts for this project (never overwrites without --force)')
    .addOption(new Option('-f, --framework <name>', 'framework (default: auto-detect)').choices(['vite', 'static']))
    .option('--owner <name>', 'legal name of the rights holder')
    .option('--terms <url>', 'terms page')
    .option('--contact <email-or-url>', 'where permission requests go')
    .option('--site <url>', 'public address of the original site')
    .option('--gitignore', 'add .dcm/ and the protected output directory to .gitignore')
    .option('--force', 'overwrite an existing configuration file')
    .option('--dry-run', 'print the configuration instead of writing it')
    .action(run((o) => handlers.init(globals(), o)));

  program
    .command('protect')
    .description('write a copy of the production build with the rights notice (the original build is never modified)')
    .option('--dry-run', 'show what would be added without writing anything')
    .action(run((o) => handlers.protect(globals(), o)));

  program
    .command('rollback')
    .description('restore the previous output from .dcm/backups')
    .action(run(() => handlers.rollback(globals())));

  program
    .command('verify')
    .description('compare the original and the output in a real browser: notice present, visuals, flows, errors, a11y, performance')
    .option('--skip-visual', 'skip screenshot comparison')
    .option('--skip-perf', 'skip performance measurement')
    .action(run((o) => handlers.verify(globals(), o)));

  program
    .command('benchmark')
    .description('run cloning tools and AI agents against your local build with and without the notice')
    .option('-r, --runner <name>', 'clone runner: mirror, copycat-capture, copycat, command, all (repeatable)', collect)
    .option('--trials <n>', 'trials per runner and side', positiveInt)
    .option('--timeout <minutes>', 'per-trial time budget in minutes', positiveInt)
    .option('--max-budget-usd <usd>', 'per-trial spend cap passed to AI runners that support it')
    .option('--model <model>', 'model for AI runners (identical for both sides)')
    .option('--follow-up <message>', 'AI runners: second user message sent in the same session when the agent stops without a clone')
    .addOption(new Option('--side <side>', 'run only one side').choices(['baseline', 'protected', 'both']).default('both'))
    .option('--compare', 'compare against the previous clone benchmark run')
    .option('--yes', 'confirm that AI runners may spend tokens on your account (non-interactive)')
    .option('--baseline-dir <dir>', 'variant mode: site directory used as side A (default: the build without notice)')
    .option('--protected-dir <dir>', 'variant mode: site directory used as side B (default: the output with notice)')
    .option('--reevaluate', 're-score the clones saved by the latest clone benchmark with the current evaluator (no runner is executed)')
    .action(run((o) => handlers.benchmark(globals(), o)));

  program
    .command('report')
    .description('combine the latest protect, verify and benchmark results')
    .addOption(new Option('-f, --format <format>', 'output format').choices(['markdown', 'json', 'html']).default('markdown'))
    .option('-o, --out <file>', 'output file (default: .dcm/report.<ext>)')
    .action(run((o) => handlers.report(globals(), o)));

  program
    .command('status')
    .description('show configuration, last runs and whether the output is up to date')
    .action(run(() => handlers.status(globals())));

  program
    .command('evidence')
    .description('record a dated hash manifest of the site, search phrases to find copies, and a takedown draft')
    .option('--dir <dir>', 'build to record (default: the output with the notice)')
    .option('--no-render', 'read the HTML files instead of rendering routes in Chromium')
    .option('--wayback', 'also ask the Internet Archive to snapshot rights.siteUrl (sends that URL to web.archive.org)')
    .action(run((o) => handlers.evidence(globals(), o)));

  program
    .command('grant')
    .description('issue a signed permission token (or --init the signing key, or --verify a token)')
    .option('--init', 'create the private signing key (rights.keyFile)')
    .option('--force', 'with --init: replace an existing key (invalidates issued tokens)')
    .option('--to <name>', 'who receives the permission')
    .option('--scope <text>', 'what the permission covers')
    .option('--days <n>', 'validity in days (default 30)', positiveInt)
    .option('--verify <token>', 'check a token against your key')
    .action(run((o) => handlers.grant(globals(), o)));

  program
    .command('shield')
    .description('generate opt-in robots.txt, TDM header, Cloudflare and nginx templates (never changes live infrastructure)')
    .option('--dry-run', 'list files without writing them')
    .option('--apply-robots', 'also write robots.txt into the output (requires waf.enabled)')
    .option('--force', 'replace an existing robots.txt in the output')
    .action(run((o) => handlers.shield(globals(), o)));

  return program;
}

export function reportError(error: unknown, debug: boolean): number {
  if (isDcmError(error)) {
    process.stderr.write(`${paint('red', '✖')} ${error.message}\n`);
    if (error.hint) process.stderr.write(`  ${paint('gray', error.hint)}\n`);
    if (debug && error.cause instanceof Error && error.cause.stack) process.stderr.write(`${paint('gray', error.cause.stack)}\n`);
    return error.exitCode;
  }
  const err = error instanceof Error ? error : new Error(String(error));
  process.stderr.write(`${paint('red', '✖')} Unexpected error: ${err.message}\n`);
  if (debug && err.stack) process.stderr.write(`${paint('gray', err.stack)}\n`);
  else process.stderr.write(`  ${paint('gray', 'Re-run with --log-level debug for a stack trace.')}\n`);
  return ExitCode.Failure;
}

export async function main(argv: string[], handlers: Handlers): Promise<number> {
  const result: ProgramResult = { exitCode: 0 };
  const program = createProgram(handlers, result);
  try {
    await program.parseAsync(argv);
    return result.exitCode;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'commander.helpDisplayed' || code === 'commander.version' || code === 'commander.help') return ExitCode.Ok;
    if (typeof code === 'string' && code.startsWith('commander.')) return ExitCode.Usage;
    return reportError(error, argv.includes('debug'));
  }
}

export { DcmError };
