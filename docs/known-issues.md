# Known issues and future improvements

## Experimental or incomplete

| Area | Status |
|---|---|
| Agent coverage | Measured with Claude Code + Copycat (claude-sonnet-5-5) only. Other agents and models are untested. |
| SSR frameworks | Only static HTML in the build is edited. Next.js and other SSR adapters were removed. |
| npm packages | Not published yet. |

## Known issues

- The notice classifier reads agent messages with patterns. It was corrected twice against real
  transcripts (past-tense refusals, the word "copycat", "I did not run X in the clone"). Read the
  transcripts behind any surprising number; `--reevaluate` re-applies fixes to saved runs.
- `dcm verify` performance numbers on loopback are small and noisy. Budgets require both a relative
  and an absolute regression (50 ms load, 25 ms script) before failing.
- Pixel similarity in clone evaluation is strict: a few pixels of layout shift lower it noticeably.
- On Windows, process-group termination and `time(1)` accounting are unavailable.

## Planned

- More trials, more models and other cloning agents.
- Notice wording variants compared head to head (`--baseline-dir` / `--protected-dir`).
- Template snippets for SSR frameworks (Next.js layout, Astro, SvelteKit).
