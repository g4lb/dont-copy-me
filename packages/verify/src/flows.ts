import type { BrowserContext, Page } from 'playwright';
import type { Flow, FlowStep } from '@dont-copy-me/core';
import { attachDiagnostics, settle, type Diagnostics } from './capture.js';

export interface StepResult {
  step: string;
  ok: boolean;
  error?: string;
}

export interface FlowResult {
  name: string;
  ok: boolean;
  steps: StepResult[];
  finalText: string;
  diagnostics: Diagnostics;
}

export function describeStep(step: FlowStep): string {
  switch (step.action) {
    case 'goto':
      return `goto ${step.path}`;
    case 'click':
      return `click ${step.selector}`;
    case 'fill':
      return `fill ${step.selector} = "${step.value}"`;
    case 'press':
      return `press ${step.key} in ${step.selector}`;
    case 'select':
      return `select "${step.value}" in ${step.selector}`;
    case 'check':
      return `check ${step.selector}`;
    case 'uncheck':
      return `uncheck ${step.selector}`;
    case 'waitFor':
      return `wait for ${step.selector}`;
    case 'expectVisible':
      return `expect ${step.selector} visible`;
    case 'expectText':
      return `expect ${step.selector} to contain "${step.text}"`;
    case 'expectUrl':
      return `expect URL path ${step.path}`;
  }
}

export async function runStep(page: Page, baseUrl: string, step: FlowStep, timeout: number): Promise<void> {
  switch (step.action) {
    case 'goto':
      await page.goto(new URL(step.path, baseUrl).toString(), { waitUntil: 'load', timeout });
      return;
    case 'click':
      await page.locator(step.selector).first().click({ timeout });
      return;
    case 'fill':
      await page.locator(step.selector).first().fill(step.value, { timeout });
      return;
    case 'press':
      await page.locator(step.selector).first().press(step.key, { timeout });
      return;
    case 'select':
      await page.locator(step.selector).first().selectOption(step.value, { timeout });
      return;
    case 'check':
      await page.locator(step.selector).first().check({ timeout });
      return;
    case 'uncheck':
      await page.locator(step.selector).first().uncheck({ timeout });
      return;
    case 'waitFor':
    case 'expectVisible':
      await page.locator(step.selector).first().waitFor({ state: 'visible', timeout });
      return;
    case 'expectText': {
      const locator = page.locator(step.selector).first();
      await locator.waitFor({ state: 'attached', timeout });
      const deadline = Date.now() + timeout;
      let text = '';
      while (Date.now() < deadline) {
        text = (await locator.innerText().catch(() => '')).replace(/\s+/g, ' ');
        if (text.includes(step.text)) return;
        await page.waitForTimeout(100);
      }
      throw new Error(`text was "${text.slice(0, 120)}"`);
    }
    case 'expectUrl': {
      await page.waitForURL((u) => u.pathname === step.path, { timeout });
      return;
    }
  }
}

/** Runs a scripted user flow; stops at the first failing step. */
export async function runFlow(context: BrowserContext, baseUrl: string, flow: Flow, timeoutMs: number, ignore: RegExp[]): Promise<FlowResult> {
  const page = await context.newPage();
  const diagnostics = attachDiagnostics(page, ignore);
  const steps: StepResult[] = [];
  try {
    await page.goto(new URL(flow.path, baseUrl).toString(), { waitUntil: 'load', timeout: timeoutMs });
    await settle(page);
    for (const step of flow.steps) {
      try {
        await runStep(page, baseUrl, step, Math.min(timeoutMs, 10_000));
        steps.push({ step: describeStep(step), ok: true });
      } catch (error) {
        steps.push({ step: describeStep(step), ok: false, error: (error as Error).message.split('\n')[0] ?? 'failed' });
        break;
      }
    }
    const finalText = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
    const ok = steps.length === flow.steps.length && steps.every((s) => s.ok);
    return { name: flow.name, ok, steps, finalText, diagnostics };
  } finally {
    await page.close();
  }
}
