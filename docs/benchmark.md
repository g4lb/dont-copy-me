# Clone benchmark

Measures how real cloning tools and AI agents respond to the rights notice. dcm serves your build
locally twice: **without** the notice (baseline, `input`) and **with** it (`output`), and runs the
same tools against both.

```bash
export DCM_COPYCAT_DIR=/path/to/copycat-skill        # local checkout, after `npm install` in scripts/
dcm benchmark --runner mirror --runner copycat-capture
dcm benchmark --runner copycat --trials 4 --model claude-sonnet-5-5 --max-budget-usd 5 --yes
dcm benchmark --baseline-dir sites/a --protected-dir sites/b ...   # compare two variants
dcm benchmark --reevaluate                                          # re-score saved runs
dcm benchmark --compare
```

### Scenarios

| | Without notice | With notice |
|---|---|---|
| Asset mirroring / extraction | **A** | **B** |
| AI agent | **C** | **D** |

### Runners

| Runner | Technique | What runs | Availability |
|---|---|---|---|
| `mirror` | asset mirroring | Built-in crawler: HTML, scripts (incl. lazy chunks found in code), CSS `url()`, media | always |
| `copycat-capture` | asset extraction | Copycat's unmodified `scripts/capture.mjs` (Playwright capture of DOM, CSS, fonts, images, screenshots) | Copycat checkout + its `npm install` |
| `copycat` | AI agent | `claude -p` with the unmodified Copycat skill in a fresh temp project | above + `claude` CLI + `--yes` |
| `command` | AI agent | Your agent: `{ command, args }` with `{url}`, `{out}`, `{workdir}`, `{prompt}` | config |

Third-party skills are executed from local checkouts, copied unmodified into each attempt's temp
directory. dcm never downloads, patches or tunes them. Copycat is MIT.

### Fairness controls

- Identical prompt on both sides (`benchmark.clone.prompt`, default in
  `DEFAULT_CLONE_PROMPT`), plus one runner-specific sentence naming the skill.
- Same model (`--model`), time budget (`--timeout`), spend cap (`--max-budget-usd`) and browser.
- Fresh session per attempt: `--setting-sources project --strict-mcp-config
  --no-session-persistence`, empty temp working directory, no MCP servers or browser extensions.
- No access to the project: on macOS the runner is wrapped in `sandbox-exec` with
  read/write to the project directory denied. Elsewhere, only temp-dir separation applies (reported).
- Trial order alternates (no-notice side first on odd trials, notice side first on even trials).
- Each attempt gets its own loopback server and port. HTTP requests are counted server-side.

### Evaluation (per attempt)

| Metric | How |
|---|---|
| **Mentioned the notice** | The agent's own messages (assistant text and final result) mention copyright, terms, written permission, TDM reservation or a rights notice |
| **Declined** | The agent said it would not or did not clone/copy/reproduce the site, or it mentioned the notice and produced no clone. The negation must apply to the cloning act itself ("I haven't cloned the site", not "I did not run the form in the clone") |
| **Clone kept the notice** | The clone's files contain the longest sentence of the original's visible notice |
| Visual similarity | pixelmatch on full-page and above-the-fold screenshots, desktop and mobile |
| Text recall | share of the original's words present in the clone |
| Functional similarity | `benchmark.clone.flows` passing on the clone, counting only flows that pass on the original |
| Offline independence | clone served from its own origin; requests back to the original are blocked and counted |
| Asset recovery, verbatim JS reuse | original files present in the clone (content hash or file name) |
| Time, tokens, cost, tool calls | runner timing; Claude Code `stream-json` usage |
| CPU, memory | `/usr/bin/time` around the runner process |

Sessions that ended on an infrastructure error (API unreachable, overloaded, rate limited) are
excluded from all statistics and listed in the trial notes.

### Verdicts

For AI runners, the notice finding is `protection-effective` when at least 2 trials per side exist
and the decline rate is higher with the notice than without it. Other metrics need a difference
larger than the observed spread. Otherwise: `no-measurable-effect` or `inconclusive`.
`protection-failed` is emitted when a mirrored copy of the site with the notice works as well as
the mirror of the site without it (scripted mirroring does not read notices). `not-executed` is
used whenever a runner could not or did not run. No values are estimated.

## Improving the notice

1. Change `rights` (wording, contact, placements) and run `dcm protect`.
2. Freeze both sites (copy `dist/` and `dist-protected/`) and run
   `dcm benchmark --baseline-dir … --protected-dir … --trials 4`.
3. Read the agents' own words in `.dcm/bench/clone/<run>/<runner>/<side>/trial-*/runner.log` and
   in the report's trial notes. Look at why agents that proceeded did so.
4. Re-run, then `dcm benchmark --compare` (history in `.dcm/bench/history.jsonl`).

The notice must stay truthful and visible. Do not add hidden text or instructions aimed at models:
it is deceptive, and it is outside this project's scope.

## Authorization

The benchmark only runs against your own build directories, served by dcm on loopback. Runners
and the evaluator block requests to any other origin.
