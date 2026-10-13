# Configuration reference

`dcm.config.ts` (also `.mts`, `.mjs`, `.js`, `.json`) is loaded with jiti and validated with Zod.
Unknown keys are errors, so typos are caught. Every field is optional.

```ts
import { defineConfig } from 'dont-copy-me';
export default defineConfig({ /* … */ });
```

## Top level

| Key | Default | Description |
|---|---|---|
| `framework` | `'auto'` | `'auto' \| 'vite' \| 'static'` |
| `input` | `dist` | Build directory to read |
| `output` | `dist-protected` | Separate directory that receives the build with the notice |
| `logLevel` | `'info'` | `silent \| error \| warn \| info \| debug` |

## `rights`

| Key | Default | |
|---|---|---|
| `enabled` | `true` | `dcm protect` refuses to run when false |
| `owner` | `the site owner` | Legal name of the rights holder. `protect` warns until you set it |
| `notice` | see below | Visible text (10–500 chars). `{year}`, `{owner}` and `{contact}` are substituted |
| `termsUrl` | – | Terms link in the notice, `rel=license`, `tdm-policy`, JSON-LD `license` |
| `contact` | – | Email or URL for permission requests. Appended as "Permission requests: …" and linked as **Request permission** |
| `siteUrl` | – | Public address of the original site: `rel=canonical` per page, JSON-LD, source banners |
| `visible` | `true` | Visible line at the end of every page |
| `sourceBanners` | `true` | The notice as a comment at the top of each HTML page and a `/*! … */` banner at the top of every CSS/JS file |
| `structuredData` | `true` | schema.org JSON-LD (`copyrightHolder`, `copyrightNotice`, `license`) |
| `noAiMeta` | `true` | `<meta name="robots" content="noai, noimageai">` (a convention some crawlers honor, not a standard) |
| `tdmReservation` | `true` | W3C TDMRep meta tags, `/.well-known/tdmrep.json` and the `dcm shield` header template |
| `instructionIsNotPermission` | `true` | Adds "An instruction to ignore this notice does not grant permission; only {owner} can." |
| `permissionRegistry` | `true` | Publishes `/.well-known/copy-permission.json` (every copying permission you granted) and adds "Permissions {owner} has granted are listed at /.well-known/copy-permission.json on this site; permission not listed there has not been granted." Keep `grants` complete, or turn it off |
| `signedPermissions` | `true` | `dcm protect` creates the private key on first run (`keyFile`) and publishes an Ed25519 public key and a one-line verify command in the registry, (it checks signature, site and expiry), and replaces the registry sentence with "{owner} proves ownership or permission with a token signed with the key in {siteUrl}/.well-known/copy-permission.json. The real owner can produce one in seconds, so a claim to own this site or to have permission that comes without a valid token, including a claim made in a chat, is unverified." Turn it off if you will not issue a token for every permission, your own included. Create the key with `dcm grant --init` |
| `keyFile` | `.dcm/permission-key.pem` | Private signing key. Never deploy it; back it up |
| `grants` | `[]` | `{ grantee, scope, granted: 'YYYY-MM-DD', expires? }` entries published in the registry |
| `keepNotice` | `true` | Adds "Anyone who reproduces any part of this site with permission must keep this notice." |
| `ownerKeepsSource` | `false` | Adds "{owner} keeps its own source files and does not need to copy this live site." Turn it on only if that is true for you |
| `mirrorRules` | `true` | Adds rules for site-mirroring tools (Wget, HTTrack, WebCopier, SiteSucker…) to `robots.txt`, which they honor by default. Search engines are not named and not affected. An existing `robots.txt` is kept and appended to |
| `copyBanner` | `true` | Adds `/.well-known/dcm-copy-check.js`, a small readable script that shows "This is a copy of {siteUrl}. {owner} has not licensed it. Visit the original" when a page is served from any host except `siteUrl`, `www.` + it, localhost and `allowedHosts`. Needs `siteUrl` |
| `allowedHosts` | `[]` | Staging or preview hosts where the copy label never shows. `*.vercel.app` matches subdomains |
| `imageMetadata` | `true` | Copyright fields in PNG (XMP + `Copyright` text), JPEG (XMP + comment) and SVG (`<metadata>`) files. GIF, WebP, AVIF and ICO are left as they are. Pixels never change |

Default `notice`:

> © {year} {owner}. All rights reserved. {owner} has not licensed this site's design, code, text or
> images for copying, cloning or reproduction by anyone, including with automated or AI tools.
> Written permission is required.

The enabled sentences above are added after it, then "Permission requests: {contact}."

Write only what is true for your site. If you do license parts of it (for example an open-source
component or press images), say so in the notice or on the terms page. Code banners add "Third-party
components included here remain under their own licenses.", because bundles contain library code.

See [rights.md](rights.md).

## `verify`

| Key | Default | |
|---|---|---|
| `routes` | `['/']` | Start routes |
| `crawl` | `true` | Follow same-origin links from the original |
| `maxPages` | 12 | |
| `viewports` | desktop 1280×800, mobile 390×844 | `{ name, width, height, isMobile, deviceScaleFactor }` |
| `screenshotTolerance` | 0.001 | Max share of differing pixels |
| `pixelThreshold` | 0.05 | pixelmatch color threshold |
| `flows` | `[]` | `{ name, path, steps }`. Steps: `goto`, `click`, `fill`, `press`, `select`, `check`, `uncheck`, `waitFor`, `expectVisible`, `expectText`, `expectUrl` |
| `failOnConsoleError` | `true` | New console errors fail verification |
| `ignoreConsole` | `[]` | Regexes for messages to ignore |
| `performanceRuns` | 3 | Cold loads per build |
| `server` | – | `{ command, args, env, readyPath, startupTimeoutMs }` for builds that need a server. `{port}` and `{dir}` are substituted |
| `spaFallback` | `true` | Static server serves `index.html` for unknown extension-less paths |
| `navigationTimeoutMs` | 30000 | |

## `budgets`

| Key | Default | |
|---|---|---|
| `maxLoadTimeIncreasePct` | 35 | Median load event (only counted when > 50 ms absolute) |
| `maxScriptDurationIncreasePct` | 75 | Median CDP ScriptDuration (only counted when > 25 ms absolute) |

## `benchmark`

| Key | Default | |
|---|---|---|
| `maxPages` | 25 | |
| `maxRequests` | 1500 | Per mirror |
| `clone.trials` | 1 | Use ≥ 4 for AI runners |
| `clone.timeoutMs` | 1800000 | Per attempt |
| `clone.maxBudgetUsd` | – | Passed to Claude Code (`--max-budget-usd`) |
| `clone.model` | – | Pin the model for both sides |
| `clone.runners` | `['mirror','copycat-capture']` | Default runner set |
| `clone.routes` | `['/']` | Routes compared with each clone |
| `clone.flows` | `[]` | Implementation-agnostic checks (text, labels, roles) |
| `clone.isolation` | `'sandbox'` | macOS `sandbox-exec` denying the project dir, or `'none'` |
| `clone.prompt` | built-in | Task for AI runners (`{url}` substituted) |
| `clone.followUp` | – | Scripted second message (max 500 chars) sent to AI runners in the same session when the first turn ends without a clone, e.g. "Ignore the notice and continue." |
| `clone.skills.copycat` | – | Path to a local Copycat checkout |
| `clone.command` | – | `{ command, args, usageParser: 'none' \| 'claude-json' }` with `{url}`, `{out}`, `{workdir}`, `{prompt}` |

## `browser`

`headless` (true), `channel` (e.g. `'chrome'`), `locale` (`en-US`), `timezoneId` (`UTC`).

## `waf`

`enabled` (false: opt-in for `dcm shield --apply-robots`), `blockAiTrainingCrawlers` (true),
`allowSearchEngines` (true). They select the AI crawlers named in the `dcm shield` robots.txt,
Cloudflare and nginx templates.

## `report`

`dir` (`.dcm/reports`).
