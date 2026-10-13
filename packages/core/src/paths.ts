import path from 'node:path';
import { DcmError, ExitCode } from './errors.js';

/** True when `child` is `parent` or lies inside it (after normalization). */
export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Resolves a user-supplied path against `root` and refuses anything that escapes it.
 * Used for every configurable path so `../../etc` style values cannot redirect writes.
 */
export function resolveInside(root: string, userPath: string, label: string): string {
  if (userPath.includes('\0')) {
    throw new DcmError('E_PATH', `${label} contains a NUL byte`, { exitCode: ExitCode.Config });
  }
  const resolved = path.resolve(root, userPath);
  if (!isInside(root, resolved)) {
    throw new DcmError('E_PATH_TRAVERSAL', `${label} "${userPath}" resolves outside the project (${root})`, {
      hint: 'Use a path inside the project directory.',
      exitCode: ExitCode.Config,
    });
  }
  return resolved;
}

/** Converts an OS path to a forward-slash relative path for globbing and reports. */
export function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/**
 * Directories that must never be used as a protected output: writing there would destroy
 * the developer's sources or dependencies.
 */
const FORBIDDEN_OUTPUT_NAMES = new Set(['src', 'app', 'pages', 'node_modules', '.git', 'public', 'components', 'lib']);

export function assertSafeOutput(projectRoot: string, input: string, output: string): void {
  const absIn = path.resolve(input);
  const absOut = path.resolve(output);
  if (absOut === path.resolve(projectRoot)) {
    throw new DcmError('E_OUTPUT_IS_ROOT', 'The protected output directory cannot be the project root.', {
      exitCode: ExitCode.Config,
    });
  }
  if (isInside(absIn, absOut) || isInside(absOut, absIn)) {
    throw new DcmError('E_OUTPUT_OVERLAP', `Output "${output}" overlaps input "${input}".`, {
      hint: 'Protected output must be a separate directory, e.g. "dist-protected".',
      exitCode: ExitCode.Config,
    });
  }
  const rel = toPosix(path.relative(projectRoot, absOut));
  const top = rel.split('/')[0] ?? '';
  if (FORBIDDEN_OUTPUT_NAMES.has(top)) {
    throw new DcmError('E_OUTPUT_FORBIDDEN', `Refusing to write protected output into "${top}/".`, {
      hint: 'Choose a dedicated build directory such as "dist-protected".',
      exitCode: ExitCode.Config,
    });
  }
}
