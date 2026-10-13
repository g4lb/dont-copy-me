import type { Browser, BrowserContext, Page } from 'playwright';
import { RIGHTS_ATTR, type DcmConfig, type Viewport } from '@dont-copy-me/core';

export interface Diagnostics {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  httpErrors: string[];
  hydrationErrors: string[];
}

export interface A11ySummary {
  missingLang: boolean;
  missingTitle: boolean;
  imagesWithoutAlt: number;
  unnamedButtons: number;
  unnamedLinks: number;
  unlabeledInputs: number;
  duplicateIds: number;
}

export interface PageCapture {
  url: string;
  status: number | null;
  title: string;
  text: string;
  screenshot: Buffer;
  links: string[];
  a11y: A11ySummary;
  diagnostics: Diagnostics;
}

/** Disables animations, transitions and the caret so screenshots are deterministic. */
const STABILIZE_CSS = `
*, *::before, *::after {
  animation-delay: -1ms !important; animation-duration: 1ms !important; animation-iteration-count: 1 !important;
  transition-duration: 0s !important; transition-delay: 0s !important; caret-color: transparent !important;
  scroll-behavior: auto !important;
}`;

export async function newStableContext(browser: Browser, viewport: Viewport, browserConfig: DcmConfig['browser']): Promise<BrowserContext> {
  return browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor,
    isMobile: viewport.isMobile,
    hasTouch: viewport.isMobile,
    locale: browserConfig.locale,
    timezoneId: browserConfig.timezoneId,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
}

export function attachDiagnostics(page: Page, ignore: RegExp[] = []): Diagnostics {
  const d: Diagnostics = { consoleErrors: [], pageErrors: [], failedRequests: [], httpErrors: [], hydrationErrors: [] };
  const ignored = (text: string): boolean => ignore.some((re) => re.test(text));
  page.on('console', (msg) => {
    const text = msg.text();
    if (ignored(text)) return;
    if (/hydrat/i.test(text) && (msg.type() === 'error' || msg.type() === 'warning')) d.hydrationErrors.push(text.slice(0, 300));
    if (msg.type() === 'error') d.consoleErrors.push(text.slice(0, 300));
  });
  page.on('pageerror', (err) => {
    if (!ignored(err.message)) d.pageErrors.push(err.message.slice(0, 300));
  });
  page.on('requestfailed', (req) => {
    const failure = req.failure()?.errorText ?? 'failed';
    // Navigations aborted by the next navigation are not application failures.
    if (failure.includes('ERR_ABORTED') && req.resourceType() === 'document') return;
    d.failedRequests.push(`${req.method()} ${new URL(req.url()).pathname} (${failure})`);
  });
  page.on('response', (res) => {
    if (res.status() >= 400) d.httpErrors.push(`${res.status()} ${new URL(res.url()).pathname}`);
  });
  return d;
}

/**
 * Waits until every visible <canvas> has painted something (or 3 s pass). Canvas art is drawn by
 * script after load, sometimes after timers; capturing too early would record an empty canvas.
 */
async function waitForCanvasPaint(page: Page): Promise<void> {
  await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll('canvas')].every((c) => {
          const r = c.getBoundingClientRect();
          if (r.width === 0 || r.height === 0 || c.width === 0 || c.height === 0) return true;
          const ctx = c.getContext('2d');
          if (!ctx) return true; // WebGL canvases cannot be sampled here
          const d = ctx.getImageData(0, 0, c.width, c.height).data;
          for (let i = 3; i < d.length; i += 64) if ((d[i] ?? 0) > 0) return true;
          return false;
        }),
      undefined,
      { timeout: 3000, polling: 100 },
    )
    .catch(() => undefined);
}

/** Elements dcm adds on purpose (rights notice) are removed before comparing builds. */
async function hideIntendedAdditions(page: Page): Promise<void> {
  await page.evaluate((attr) => document.querySelectorAll(`[${attr}]`).forEach((e) => e.remove()), RIGHTS_ATTR).catch(() => undefined);
}

export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts.ready.then(() => undefined)).catch(() => undefined);
  await waitForCanvasPaint(page);
  await hideIntendedAdditions(page);
  await page.addStyleTag({ content: STABILIZE_CSS }).catch(() => undefined);
  // Two animation frames let layout settle after the stylesheet is applied.
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))).catch(() => undefined);
}

export async function readA11y(page: Page): Promise<A11ySummary> {
  return page.evaluate(() => {
    const name = (el: Element): string =>
      (el.getAttribute('aria-label') ?? el.getAttribute('title') ?? (el as HTMLElement).innerText ?? '').trim();
    const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
    const inputs = [...document.querySelectorAll('input:not([type=hidden]), select, textarea')];
    return {
      missingLang: !document.documentElement.lang,
      missingTitle: !document.title.trim(),
      imagesWithoutAlt: [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt')).length,
      unnamedButtons: [...document.querySelectorAll('button, [role=button]')].filter((b) => !name(b)).length,
      unnamedLinks: [...document.querySelectorAll('a[href]')].filter((a) => !name(a) && !a.querySelector('img[alt]')).length,
      unlabeledInputs: inputs.filter((i) => {
        const id = i.id;
        const labelled = i.closest('label') || (id && document.querySelector(`label[for="${CSS.escape(id)}"]`));
        return !labelled && !i.getAttribute('aria-label') && !i.getAttribute('aria-labelledby');
      }).length,
      duplicateIds: ids.length - new Set(ids).size,
    };
  });
}

export async function capturePage(
  context: BrowserContext,
  url: string,
  options: { timeoutMs: number; ignoreConsole: RegExp[]; fullPage?: boolean },
): Promise<PageCapture> {
  const page = await context.newPage();
  const diagnostics = attachDiagnostics(page, options.ignoreConsole);
  try {
    const response = await page.goto(url, { waitUntil: 'load', timeout: options.timeoutMs });
    await settle(page);
    let screenshot: Buffer;
    if (options.fullPage ?? true) {
      // Grow the viewport to the page height first: Playwright's full-page capture resizes the
      // viewport mid-capture, which clears <canvas> elements that redraw asynchronously.
      const viewport = page.viewportSize();
      const height = await page.evaluate(() => Math.ceil(Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)));
      if (viewport && height > viewport.height) {
        // Reload at the final size so canvases initialize at it instead of being resized
        // (some implementations never redraw after a resize under reduced motion).
        await page.setViewportSize({ width: viewport.width, height: Math.min(height, 12_000) });
        await page.reload({ waitUntil: 'load', timeout: options.timeoutMs });
        await settle(page);
      }
      screenshot = await page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide' });
      if (viewport) await page.setViewportSize(viewport);
    } else {
      screenshot = await page.screenshot({ animations: 'disabled', caret: 'hide' });
    }
    const [title, text, links, a11y] = await Promise.all([
      page.title(),
      page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim()),
      page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => (a as HTMLAnchorElement).href)),
      readA11y(page),
    ]);
    return { url, status: response?.status() ?? null, title, text, screenshot, links, a11y, diagnostics };
  } finally {
    await page.close();
  }
}
