# Contributing to Don't Copy Me

Thank you for your help. This project makes claims about security and measurement, so it needs
strong evidence:

- Every feature needs working code and real tests.
- The docs must not say more than the code does.

## Setup

```bash
pnpm install
pnpm exec playwright install chromium   # browser tests and verify
pnpm build                              # tsc -b, all packages
```

You need Node.js ≥ 22.12 and pnpm 11 (`packageManager`: `pnpm@11.24.0`).

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

Dependencies go in one direction only: `core` ← engines/adapters ← `cli`. No package can import
`cli`.

## Rules

1. **Do not invent numbers.** Benchmarks and reports show only measured values. If something did
   not run, the report says `not executed`.
2. **Keep the notice honest.** We close PRs that break this rule.
   - No hidden text.
   - No instructions aimed at AI models (prompt injection).
   - No false legal claims.
   - Every placement says the same thing as the visible line.
3. **Never change user sources.** Changes apply only to a staged copy of the build.
4. **Add tests** for each behavior change.
   - Do not write tests that always pass.
   - Put browser-dependent tests in `tests/browser/`.
5. **Use strict TypeScript.** Do not use `any`. If you must use it, write a comment that tells why.
6. **Keep third-party cloning skills out of the repository.** Runners use local checkouts from the
   user, with no changes.

## Add a framework adapter

1. Implement `FrameworkAdapter` from `@dont-copy-me/core`. Include `detect`, defaults,
   `serveMode` and `limitations`. `copyIgnore` and `urlToBuildPath` are optional.
2. Register the adapter in `packages/cli/src/context.ts`.
3. Add fixture-based tests in `tests/integration/adapters.test.ts`.

## Add a clone runner

1. Implement `CloneRunner` (`packages/benchmark/src/clone/types.ts`).
2. Register it in `clone/registry.ts`.
3. Make `availability()` tell the exact reason when the runner cannot run.
4. For an AI runner, set `requiresAi: true`. Then it never runs without consent.

## Commits

- Keep each commit on one topic.
- Use the imperative mood ("Add notice placement for SVG files").
- Run `pnpm check` before you commit.
