import { DcmError, ExitCode } from './errors.js';

/**
 * Authorization for every network destination touched by benchmarks: a destination is permitted
 * only when its origin (scheme + host + port) is one of the local servers dcm started.
 */
export interface AuthorizationPolicy {
  origins: ReadonlySet<string>;
}

export function createPolicy(authorizedUrls: readonly string[]): AuthorizationPolicy {
  const origins = new Set<string>();
  for (const raw of authorizedUrls) {
    const url = parseHttpUrl(raw, 'authorized URL');
    origins.add(url.origin);
  }
  return { origins };
}

export function parseHttpUrl(raw: string, label = 'URL'): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DcmError('E_URL', `Invalid ${label}: ${raw}`, { exitCode: ExitCode.Usage });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new DcmError('E_URL_SCHEME', `Only http(s) URLs are allowed (${label}: ${raw})`, { exitCode: ExitCode.Usage });
  }
  if (url.username || url.password) {
    throw new DcmError('E_URL_CREDENTIALS', `URLs with embedded credentials are refused (${label})`, {
      exitCode: ExitCode.Usage,
    });
  }
  return url;
}

export function isOriginAuthorized(raw: string, policy: AuthorizationPolicy): boolean {
  try {
    const url = new URL(raw);
    return policy.origins.has(url.origin);
  } catch {
    return false;
  }
}
