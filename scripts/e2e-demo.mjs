#!/usr/bin/env node
// End-to-end workflow on examples/vite-demo, exactly as a user runs it:
// build → init (in a scratch copy) → protect → verify → clone benchmark (non-AI runner) →
// reports → shield → standalone skill script. Fails on the first error.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const demo = path.join(root, 'examples', 'vite-demo');
const dcm = path.join(root, 'packages', 'cli', 'dist', 'bin.js');
const skill = path.join(root, '.claude', 'skills', 'dont-copy-me', 'scripts', 'dcm.mjs');

function run(label, command, args, cwd = demo, expectCode = 0) {
  process.stdout.write(`\n▶ ${label}\n`);
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, NO_COLOR: '1' } });
  if (result.status !== expectCode) {
    process.stderr.write(`✖ ${label} exited with ${result.status} (expected ${expectCode})\n`);
    process.exit(1);
  }
}

run('build the demo app', 'pnpm', ['--filter', 'vite-demo', 'build'], root);

// `dcm init` on a scratch copy so the committed demo config is not overwritten.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dcm-init-'));
fs.writeFileSync(path.join(scratch, 'package.json'), JSON.stringify({ name: 'scratch', devDependencies: { vite: '^8.0.0' } }));
fs.writeFileSync(path.join(scratch, 'vite.config.ts'), 'export default {}\n');
run('dcm init', process.execPath, [dcm, 'init', '--owner', 'Scratch Ltd', '--contact', 'legal@scratch.test', '--gitignore'], scratch);
const initConfig = fs.readFileSync(path.join(scratch, 'dcm.config.ts'), 'utf8');
if (!initConfig.includes("framework: 'vite'") || !initConfig.includes("owner: 'Scratch Ltd'")) {
  process.stderr.write('✖ dcm init did not detect Vite or write the owner\n');
  process.exit(1);
}
run('dcm init refuses to overwrite', process.execPath, [dcm, 'init'], scratch, 2);
fs.rmSync(scratch, { recursive: true, force: true });

run('dcm protect --dry-run', process.execPath, [dcm, 'protect', '--dry-run']);
run('dcm protect', process.execPath, [dcm, 'protect']);
run('dcm verify', process.execPath, [dcm, 'verify']);
run('dcm benchmark --runner mirror', process.execPath, [dcm, 'benchmark', '--runner', 'mirror']);
run('dcm shield', process.execPath, [dcm, 'shield']);
for (const format of ['markdown', 'json', 'html']) run(`dcm report --format ${format}`, process.execPath, [dcm, 'report', '--format', format]);
// The standalone skill script, on a scratch copy of the demo build.
const skillProject = fs.mkdtempSync(path.join(os.tmpdir(), 'dcm-skill-'));
fs.cpSync(path.join(demo, 'dist'), path.join(skillProject, 'dist'), { recursive: true });
run('skill: init', process.execPath, [skill, 'init', '--owner', 'Lumen Analytics', '--site', 'https://lumen.example', '--contact', 'legal@lumen.example'], skillProject);
run('skill: protect', process.execPath, [skill, 'protect'], skillProject);
for (const file of ['dist-protected/robots.txt', 'dist-protected/.well-known/copy-permission.json', 'dist-protected/.well-known/dcm-copy-check.js']) {
  if (!fs.existsSync(path.join(skillProject, file))) {
    process.stderr.write(`✖ skill did not write ${file}\n`);
    process.exit(1);
  }
}
fs.rmSync(skillProject, { recursive: true, force: true });

for (const file of ['dist-protected/index.html', 'dist-protected/.well-known/tdmrep.json', '.dcm/shield/tdm-headers.txt', '.dcm/report.md', '.dcm/report.json', '.dcm/report.html', '.dcm/reports/verify.json']) {
  if (!fs.existsSync(path.join(demo, file))) {
    process.stderr.write(`✖ expected ${file}\n`);
    process.exit(1);
  }
}
const page = fs.readFileSync(path.join(demo, 'dist-protected', 'index.html'), 'utf8');
for (const needle of ['data-dcm-rights', 'Lumen Analytics has not licensed', 'application/ld+json', 'tdm-reservation']) {
  if (!page.includes(needle)) {
    process.stderr.write(`✖ notice incomplete: "${needle}" missing from dist-protected/index.html\n`);
    process.exit(1);
  }
}
process.stdout.write('\n✔ end-to-end workflow completed\n');
