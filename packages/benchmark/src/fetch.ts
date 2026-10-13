import { isOriginAuthorized, type AuthorizationPolicy } from '@dont-copy-me/core';
import type { NetworkLedger } from './guard.js';

export interface FetchResult {
  status: number;
  body: Buffer;
  contentType: string;
}

/**
 * HTTP GET restricted to authorized origins. Redirects are followed manually (max 3) and each
 * hop is re-authorized, so an authorized URL cannot bounce the request to another host.
 */
export async function guardedFetch(
  url: string,
  policy: AuthorizationPolicy,
  ledger: NetworkLedger,
  options: { maxRequests: number; timeoutMs?: number; maxBytes?: number } = { maxRequests: Infinity },
): Promise<FetchResult | undefined> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    if (!isOriginAuthorized(current, policy)) {
      ledger.blocked.push(current.slice(0, 200));
      return undefined;
    }
    if (ledger.requests >= options.maxRequests) {
      ledger.overBudget++;
      return undefined;
    }
    ledger.requests++;
    let res: Response;
    try {
      res = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(options.timeoutMs ?? 15_000), headers: { 'user-agent': 'dont-copy-me-benchmark/0.1' } });
    } catch (error) {
      ledger.failed.push(`${current.slice(0, 160)} (${(error as Error).message})`);
      return undefined;
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) return { status: res.status, body: Buffer.alloc(0), contentType: '' };
      current = new URL(location, current).toString();
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const body = options.maxBytes && buf.length > options.maxBytes ? buf.subarray(0, options.maxBytes) : buf;
    ledger.bytes += buf.length;
    return { status: res.status, body, contentType: res.headers.get('content-type') ?? '' };
  }
  return undefined;
}
