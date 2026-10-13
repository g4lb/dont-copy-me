import type { Browser } from 'playwright';
import { median, type DcmConfig } from '@dont-copy-me/core';
import { newStableContext } from './capture.js';

export interface LoadSample {
  domContentLoadedMs: number;
  loadMs: number;
  firstContentfulPaintMs: number | null;
  largestContentfulPaintMs: number | null;
  cumulativeLayoutShift: number;
  scriptDurationMs: number | null;
  taskDurationMs: number | null;
  jsHeapUsedBytes: number | null;
  scriptBytes: number;
  requests: number;
}

export interface PerfSummary {
  runs: number;
  median: { [K in keyof LoadSample]: number | null };
  samples: LoadSample[];
}

/**
 * Cold-load measurements in a fresh context per run. Chromium-only CDP metrics
 * (ScriptDuration, TaskDuration, JSHeapUsedSize) are reported when available.
 * Local loopback timings are small and noisy; treat them as relative, not absolute.
 */
export async function measureLoads(browser: Browser, url: string, runs: number, browserConfig: DcmConfig['browser']): Promise<PerfSummary> {
  const samples: LoadSample[] = [];
  for (let i = 0; i < runs; i++) {
    const context = await newStableContext(browser, { name: 'perf', width: 1280, height: 800, isMobile: false, deviceScaleFactor: 1 }, browserConfig);
    const page = await context.newPage();
    let scriptBytes = 0;
    let requests = 0;
    page.on('response', (res) => {
      requests++;
      if (res.request().resourceType() === 'script') {
        const len = Number(res.headers()['content-length'] ?? 0);
        scriptBytes += Number.isFinite(len) ? len : 0;
      }
    });
    await page.addInitScript(() => {
      const w = window as unknown as { __dcmLcp: number | null; __dcmCls: number };
      w.__dcmLcp = null;
      w.__dcmCls = 0;
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) w.__dcmLcp = entry.startTime;
        }).observe({ type: 'largest-contentful-paint', buffered: true });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>) {
            if (!entry.hadRecentInput) w.__dcmCls += entry.value;
          }
        }).observe({ type: 'layout-shift', buffered: true });
      } catch {
        // observers unsupported
      }
    });
    let cdpMetrics: Record<string, number> = {};
    let cdp: Awaited<ReturnType<typeof context.newCDPSession>> | undefined;
    try {
      cdp = await context.newCDPSession(page);
      await cdp.send('Performance.enable');
    } catch {
      cdp = undefined;
    }
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    if (cdp) {
      const { metrics } = await cdp.send('Performance.getMetrics');
      cdpMetrics = Object.fromEntries(metrics.map((m) => [m.name, m.value]));
    }
    const timing = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      const fcp = performance.getEntriesByName('first-contentful-paint')[0];
      const w = window as unknown as { __dcmLcp: number | null; __dcmCls: number };
      return {
        dcl: nav ? nav.domContentLoadedEventEnd : 0,
        load: nav ? nav.loadEventEnd : 0,
        fcp: fcp ? fcp.startTime : null,
        lcp: w.__dcmLcp,
        cls: w.__dcmCls,
      };
    });
    samples.push({
      domContentLoadedMs: timing.dcl,
      loadMs: timing.load,
      firstContentfulPaintMs: timing.fcp,
      largestContentfulPaintMs: timing.lcp,
      cumulativeLayoutShift: timing.cls,
      scriptDurationMs: cdpMetrics.ScriptDuration !== undefined ? cdpMetrics.ScriptDuration * 1000 : null,
      taskDurationMs: cdpMetrics.TaskDuration !== undefined ? cdpMetrics.TaskDuration * 1000 : null,
      jsHeapUsedBytes: cdpMetrics.JSHeapUsedSize ?? null,
      scriptBytes,
      requests,
    });
    await context.close();
  }
  const keys = Object.keys(samples[0] ?? {}) as Array<keyof LoadSample>;
  const med = Object.fromEntries(
    keys.map((k) => [k, median(samples.map((s) => s[k]).filter((v): v is number => typeof v === 'number'))]),
  ) as PerfSummary['median'];
  return { runs, median: med, samples };
}
