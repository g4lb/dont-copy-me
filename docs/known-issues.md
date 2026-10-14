# Known issues and future improvements

## Experimental or incomplete

| Area | Status |
|---|---|
| Agent coverage | We measured only Claude Code + Copycat (claude-sonnet-5-5). We did not test other agents or models. |
| SSR frameworks | dcm edits only the static HTML in the build. We removed Next.js and the other SSR adapters. |
| npm packages | Not published yet. |

## Known issues

- **Notice classifier.** It uses patterns to read agent messages. We corrected it two times
  against real transcripts. The corrections were for past-tense refusals, the word "copycat", and
  "I did not run X in the clone".
  - If a number looks wrong, read the transcripts behind it.
  - `--reevaluate` applies the corrections again to saved runs.
- **`dcm verify` performance numbers.** On loopback these numbers are small and noisy. A budget
  fails only when it sees both a relative and an absolute regression (50 ms load, 25 ms script).
- **Pixel similarity.** The clone evaluation is strict here. A few pixels of layout shift make the
  score noticeably lower.
- **Windows.** Process-group termination and `time(1)` accounting are not available.

## Planned

- More trials, more models and other cloning agents.
- Head-to-head tests of different notice texts (`--baseline-dir` / `--protected-dir`).
- Template snippets for SSR frameworks (Next.js layout, Astro, SvelteKit).
