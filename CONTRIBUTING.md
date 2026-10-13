# Contributing to Don't Copy Me

Thanks for helping. This project makes claims about security and measurement, so the bar for
evidence is high: every feature needs working code and real tests, and docs must not overstate
what the code does.

## Setup

```bash
pnpm install
pnpm exec playwright install chromium   # browser tests and verify
pnpm build                              # tsc -b, all packages
```

Node.js ≥ 22.12 and pnpm 11 (`packageManager`: `pnpm@11.24.0`) are required.

## Everyday commands

| Command | What it does |
|---|---|
| `pnpm build` | Compile every package (TypeScript project references) |
| `pnpm typecheck` | Packages + tests, strict mode |
| `pnpm lint` | ESLint (typescript-eslint) |
| `pnpm test:unit` | Fast unit + integration tests |
| `pnpm test` | All tests, including Playwright browser tests |
| `pnpm e2e` | Full CLI workflow on `examples/vite-demo` |
| `pnpm check` | build + typecheck + lint + test |

## Layout

```
packages/core            config schema, safety primitives (paths, atomic output, URL guard), adapters contract, static server
packages/notice          rights notice rendering and placement, SRI updates, protect pipeline
packages/verify          Playwright verification (notice present, visual, flows, errors, a11y, performance)
packages/benchmark       clone benchmark runners, notice-response classifier, evaluation
packages/framework-vite  Vite adapter + build plugin
packages/reporter        Markdown / JSON / HTML reports
packages/shield          robots.txt / TDM header / Cloudflare / nginx templates
packages/cli             dcm CLI (commander)
.claude/skills/dont-copy-me   Claude Code Skill
```

Dependencies flow one way: `core` ← engines/adapters ← `cli`. No package may import `cli`.

## Rules

1. **No fabricated numbers.** Benchmarks and reports only show measured values. Anything not
   run is reported as `not executed`.
2. **The notice stays honest.** No hidden text, no instructions aimed at AI models (prompt
   injection), no false legal claims. Every placement says what the visible line says. PRs that
   break this will be closed.
3. **Never touch user sources.** Changes only apply to a staged copy of the build.
4. **Tests are required** for behavior changes. Do not write tests that always pass. For a
   browser-dependent test, put it in `tests/browser/`.
5. **Strict TypeScript.** Avoid `any`. If it is truly unavoidable, explain why in a comment.
6. Keep third-party cloning skills out of the repository. Runners execute local checkouts provided
   by the user, unmodified.

## Adding a framework adapter

Implement `FrameworkAdapter` from `@dont-copy-me/core` (`detect`, defaults, `serveMode`,
`limitations`, optional `copyIgnore`, `urlToBuildPath`), register it in
`packages/cli/src/context.ts`, and add fixture-based tests in `tests/integration/adapters.test.ts`.

## Adding a clone runner

Implement `CloneRunner` (`packages/benchmark/src/clone/types.ts`), register it in
`clone/registry.ts`, and make `availability()` explain precisely why it cannot run. AI runners
must set `requiresAi: true` so they never run without consent.

## Commits

Keep commits focused, use the imperative mood ("Add notice placement for SVG files"), and run `pnpm check`
first.
