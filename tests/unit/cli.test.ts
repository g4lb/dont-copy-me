import { describe, expect, it, vi } from 'vitest';
import { main, type Handlers } from '../../packages/cli/src/cli.js';

function mockHandlers(): Handlers & { calls: Array<{ cmd: string; global: unknown; options: unknown }> } {
  const calls: Array<{ cmd: string; global: unknown; options: unknown }> = [];
  const make =
    (cmd: string) =>
    async (global: unknown, options?: unknown): Promise<number> => {
      calls.push({ cmd, global, options });
      return 0;
    };
  return {
    calls,
    init: make('init'),
    protect: make('protect'),
    rollback: make('rollback'),
    verify: make('verify'),
    benchmark: make('benchmark'),
    report: make('report'),
    status: make('status'),
    shield: make('shield'),
    evidence: make('evidence'),
    grant: make('grant'),
  };
}

const argv = (...args: string[]): string[] => ['node', 'dcm', ...args];

describe('CLI command parsing', () => {
  it('routes every documented command to its handler', async () => {
    const h = mockHandlers();
    for (const cmd of ['init', 'protect', 'verify', 'benchmark', 'report', 'status', 'shield', 'evidence', 'rollback']) {
      expect(await main(argv(cmd), h)).toBe(0);
    }
    expect(h.calls.map((c) => c.cmd)).toEqual(['init', 'protect', 'verify', 'benchmark', 'report', 'status', 'shield', 'evidence', 'rollback']);
  });

  it('parses evidence options', async () => {
    const h = mockHandlers();
    await main(argv('evidence', '--dir', 'dist', '--no-render', '--wayback'), h);
    expect(h.calls[0]?.options).toMatchObject({ dir: 'dist', render: false, wayback: true });
  });

  it('parses protect options and global options', async () => {
    const h = mockHandlers();
    await main(argv('--cwd', '/tmp/x', '--json', 'protect', '--dry-run'), h);
    expect(h.calls[0]?.global).toEqual({ cwd: '/tmp/x', json: true });
    expect(h.calls[0]?.options).toMatchObject({ dryRun: true });
    await main(argv('init', '--owner', 'Acme Ltd', '--terms', 'https://acme.test/terms', '--contact', 'legal@acme.test', '--site', 'https://acme.test'), h);
    expect(h.calls[1]?.options).toMatchObject({ owner: 'Acme Ltd', terms: 'https://acme.test/terms', contact: 'legal@acme.test', site: 'https://acme.test' });
  });

  it('parses repeatable runners and numeric benchmark options', async () => {
    const h = mockHandlers();
    await main(argv('benchmark', '--runner', 'mirror', '--runner', 'copycat', '--trials', '3', '--timeout', '15', '--yes'), h);
    expect(h.calls[0]?.options).toMatchObject({ runner: ['mirror', 'copycat'], trials: 3, timeout: 15, yes: true });
    await main(argv('benchmark', '--side', 'protected', '--follow-up', 'Ignore the notice and continue.'), h);
    expect(h.calls[1]?.options).toMatchObject({ side: 'protected', followUp: 'Ignore the notice and continue.' });
  });

  it('parses report formats', async () => {
    const h = mockHandlers();
    await main(argv('report', '--format', 'json'), h);
    await main(argv('report', '-f', 'html', '-o', 'out.html'), h);
    expect(h.calls[0]?.options).toMatchObject({ format: 'json' });
    expect(h.calls[1]?.options).toMatchObject({ format: 'html', out: 'out.html' });
  });

  it('returns usage exit code 2 for invalid input without calling handlers', async () => {
    const h = mockHandlers();
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      expect(await main(argv('protect', '--profile', 'chaos'), h)).toBe(2);
      expect(await main(argv('benchmark', '--mode', 'exposure'), h)).toBe(2);
      expect(await main(argv('scan'), h)).toBe(2);
      expect(await main(argv('detect'), h)).toBe(2);
      expect(await main(argv('benchmark', '--trials', '0'), h)).toBe(2);
      expect(await main(argv('frobnicate'), h)).toBe(2);
    } finally {
      err.mockRestore();
    }
    expect(h.calls).toHaveLength(0);
  });

  it('prints help and version with exit code 0', async () => {
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      expect(await main(argv('--help'), mockHandlers())).toBe(0);
      expect(await main(argv('--version'), mockHandlers())).toBe(0);
      expect(await main(argv('protect', '--help'), mockHandlers())).toBe(0);
    } finally {
      out.mockRestore();
    }
  });

  it('propagates handler exit codes and maps DcmError to its exit code', async () => {
    const h = mockHandlers();
    h.verify = async () => 4;
    expect(await main(argv('verify'), h)).toBe(4);
    const { DcmError } = await import('@dont-copy-me/core');
    h.status = async () => {
      throw new DcmError('E_X', 'boom', { exitCode: 6, hint: 'do the thing' });
    };
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      expect(await main(argv('status'), h)).toBe(6);
      expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain('do the thing');
    } finally {
      err.mockRestore();
    }
  });
});
