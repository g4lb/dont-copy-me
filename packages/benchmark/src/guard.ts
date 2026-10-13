import type { BrowserContext } from 'playwright';
import { isOriginAuthorized, type AuthorizationPolicy } from '@dont-copy-me/core';

export interface NetworkLedger {
  requests: number;
  bytes: number;
  blocked: string[];
  failed: string[];
  overBudget: number;
}

export function newLedger(): NetworkLedger {
  return { requests: 0, bytes: 0, blocked: [], failed: [], overBudget: 0 };
}

/**
 * Routes every request of a browser context through the authorization policy and the request
 * budget. Unauthorized destinations (including redirects and third-party subresources) are
 * aborted and recorded rather than fetched.
 */
export async function guardContext(context: BrowserContext, policy: AuthorizationPolicy, maxRequests: number, ledger: NetworkLedger): Promise<void> {
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith('data:') || url.startsWith('blob:')) {
      await route.continue();
      return;
    }
    if (!isOriginAuthorized(url, policy)) {
      ledger.blocked.push(url.slice(0, 200));
      await route.abort('blockedbyclient');
      return;
    }
    if (ledger.requests >= maxRequests) {
      ledger.overBudget++;
      await route.abort('blockedbyclient');
      return;
    }
    ledger.requests++;
    await route.continue();
  });
  context.on('requestfailed', (req) => {
    const reason = req.failure()?.errorText ?? '';
    if (!reason.includes('BLOCKED_BY_CLIENT')) ledger.failed.push(`${req.url().slice(0, 160)} (${reason})`);
  });
  context.on('response', (res) => {
    const len = Number(res.headers()['content-length'] ?? 0);
    if (Number.isFinite(len)) ledger.bytes += len;
  });
}
