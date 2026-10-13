import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPolicy, isOriginAuthorized, parseHttpUrl, startStaticServer } from '@dont-copy-me/core';
import { guardedFetch, newLedger } from '@dont-copy-me/benchmark';
import { tempDir, writeTree } from '../helpers.js';

describe('benchmark authorization', () => {
  it('matches by origin (scheme, host and port)', () => {
    const policy = createPolicy(['http://127.0.0.1:4173']);
    expect(isOriginAuthorized('http://127.0.0.1:4173/deep/path?q=1', policy)).toBe(true);
    expect(isOriginAuthorized('https://127.0.0.1:4173/', policy)).toBe(false);
    expect(isOriginAuthorized('http://127.0.0.1:8443/', policy)).toBe(false);
    expect(isOriginAuthorized('not a url', policy)).toBe(false);
  });

  it('rejects non-http schemes and embedded credentials', () => {
    expect(() => parseHttpUrl('file:///etc/passwd')).toThrow(/Only http/);
    expect(() => parseHttpUrl('https://user:pass@mine.example')).toThrow(/credentials/);
    expect(() => parseHttpUrl('javascript:alert(1)')).toThrow();
  });
});

describe('guarded fetching', () => {
  let redirector: http.Server;
  let redirectorUrl = '';
  let target: Awaited<ReturnType<typeof startStaticServer>>;

  beforeAll(async () => {
    const dir = await tempDir();
    await writeTree(dir, { 'index.html': '<h1>ok</h1>', 'a.js': 'export{}' });
    target = await startStaticServer({ root: dir });
    redirector = http.createServer((req, res) => {
      res.writeHead(302, { location: req.url === '/same' ? '/landing' : `${target.url}/index.html` }).end();
    });
    await new Promise<void>((r) => redirector.listen(0, '127.0.0.1', () => r()));
    redirectorUrl = `http://127.0.0.1:${(redirector.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await target.close();
    await new Promise<void>((r) => redirector.close(() => r()));
  });

  it('refuses redirects to origins outside the policy', async () => {
    const ledger = newLedger();
    const res = await guardedFetch(`${redirectorUrl}/elsewhere`, createPolicy([redirectorUrl]), ledger, { maxRequests: 10 });
    expect(res).toBeUndefined();
    expect(ledger.blocked[0]).toContain(target.url);
  });

  it('enforces the request budget', async () => {
    const ledger = newLedger();
    const policy = createPolicy([target.url]);
    await guardedFetch(`${target.url}/a.js`, policy, ledger, { maxRequests: 1 });
    const second = await guardedFetch(`${target.url}/a.js`, policy, ledger, { maxRequests: 1 });
    expect(second).toBeUndefined();
    expect(ledger.overBudget).toBe(1);
  });

  it('static server redirects directories without a trailing slash, like real static hosts', async () => {
    const dir = await tempDir();
    await writeTree(dir, { 'index.html': 'home', 'pricing/index.html': 'pricing page' });
    const s = await startStaticServer({ root: dir, spaFallback: true });
    try {
      const res = await fetch(`${s.url}/pricing?x=1`, { redirect: 'manual' });
      expect(res.status).toBe(301);
      expect(res.headers.get('location')).toBe('/pricing/?x=1');
      expect(await (await fetch(`${s.url}/pricing`)).text()).toBe('pricing page');
      expect(await (await fetch(`${s.url}/unknown-route`)).text()).toBe('home');
    } finally {
      await s.close();
    }
  });

  it('static server rejects path traversal and never serves .git', async () => {
    const traversal = await fetch(`${target.url}/..%2f..%2fetc%2fpasswd`);
    expect([403, 404]).toContain(traversal.status);
    expect((await fetch(`${target.url}/.git/config`)).status).toBe(404);
    expect(target.requests.filter((r) => /etc|\.git/.test(r.path)).every((r) => r.status !== 200)).toBe(true);
    expect((await fetch(`${target.url}/a.js`)).status).toBe(200);
  });
});
