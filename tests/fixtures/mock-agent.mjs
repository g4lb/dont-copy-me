#!/usr/bin/env node
// Test double for an AI reconstruction agent. It "clones" the target by fetching index.html,
// about.html and the assets it references, writes them to ./clone and emits Claude Code-style
// stream-json usage lines. Used only by automated tests; it never calls a model.
import fs from 'node:fs/promises';
import path from 'node:path';

const [url, out] = process.argv.slice(2);
const files = ['/', '/about.html', '/assets/app.css', '/assets/app.js', '/assets/pricing.js'];
let toolCalls = 0;
for (const f of files) {
  const res = await fetch(new URL(f, url));
  toolCalls++;
  process.stdout.write(`${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'WebFetch' }] } })}\n`);
  const dest = path.join(out, f === '/' ? 'index.html' : f);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
}
process.stdout.write(`${JSON.stringify({ type: 'result', subtype: 'success', total_cost_usd: 0, num_turns: toolCalls, usage: { input_tokens: 100, output_tokens: 50 } })}\n`);
