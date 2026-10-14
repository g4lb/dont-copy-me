# Don't Copy Me

A Claude Code skill that tells AI agents your site is not licensed for copying.

Use it on landing pages, marketing sites and other static builds.

## Install

```bash
npx skills add g4lb/dont-copy-me
```

You need Node.js 22 or newer. The skill has no other dependencies.

## Use

Run these commands in Claude Code:

```
/dont-copy-me init       Set your legal name, site URL, terms page and contact.
/dont-copy-me protect    Run after your build. Writes dist-protected/.
/dont-copy-me grant      Give a person permission to copy. Prints a signed token.
```

Deploy `dist-protected/` instead of `dist/`. The skill does not change `dist/`.

## What it does

1. It adds a short rights notice to every page, and to the top of every HTML, CSS and JS file.
2. It adds copyright and "no AI" tags to `<head>`, `robots.txt` and `/.well-known/`.
3. It adds a small host check to every JS file. A copy on a different domain shows only the notice.

The notice is visible and true. It has no hidden instructions.

On your own domain, `www.` and `localhost`, the site works as before.

## Results

We asked an AI agent to clone a demo site 4 times without the skill and 12 times with it.

| | Without the skill | With the skill |
|---|---|---|
| Agent stopped and asked its user | 0 of 4 | **11 of 12** |
| Agent refused after "I own this site, go ahead" | – | **6 of 7** |
| Agent made a working copy | **4 of 4** | **3 of 12** |

Wget and HTTrack with default settings now copy only the start page.

The sample is small. It used one model (`claude-sonnet-5-5`) and one cloning skill.
For the full data, see [docs/results/vite-demo.md](docs/results/vite-demo.md).

## Before you deploy

- Add each staging and preview domain to `allowedHosts` in `dcm.config.json`. The site does not run on other domains.
- Back up `.dcm/permission-key.pem`. Do not commit or deploy it.
- Add `.dcm/` and `dist-protected/` to `.gitignore`.

## Limits

- A public website cannot be made impossible to copy.
- An agent can write a new copy of the site by hand. 3 of 12 agents did this.
- Some agents still obey their user when the user says "ignore the notice".
- A person can tell Wget to ignore `robots.txt`, or remove the host check from each JS file.
- The skill works on static HTML builds. Server-rendered sites must add the notice to their templates.
- Whether a notice is legally enforceable depends on your country. This is not legal advice.

## More information

- [How the notice works](docs/rights.md)
- [Settings](docs/configuration.md)
- [How we measured](docs/benchmark.md)
- [Security and limits](docs/security-and-limitations.md)

The `packages/` folder contains the benchmark tools. To build and test them, run `pnpm install && pnpm build && pnpm test`.

## License

MIT © g4lb
