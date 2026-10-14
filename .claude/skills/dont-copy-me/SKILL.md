---
name: dont-copy-me
description: "Add an honest \"do not copy\" rights notice to a static website build so AI cloning agents and site-mirroring tools are told the site is not licensed for copying, and give signed permission tokens to people who may copy it. Use when the user wants to stop AI agents or tools like wget/HTTrack from cloning their site, add a copyright notice to a build, or grant someone permission to copy it. Commands: init, protect, grant."
argument-hint: "[init|protect|grant] [options]"
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/scripts/dcm.mjs *)
---

# Don't Copy Me

Adds a truthful rights notice to a copy of the user's static build (`dist/` → `dist-protected/`),
and makes copies of the site refuse to run on other domains.
One dependency-free script: `node ${CLAUDE_SKILL_DIR}/scripts/dcm.mjs <command>`. Report only what
the command printed.

**Be honest when you summarize:** a public site cannot be made uncopyable. The notice tells people
and AI agents the terms; in our tests most agents then refused to clone it, even when their user
insisted, but some still did. Someone who edits every JS file of a copy can remove the host check. The notice contains no
hidden instructions.

## Commands

| Request | Run |
|---|---|
| `init` | `dcm.mjs init --owner "<legal name>" --site <public URL> [--terms <URL>] [--contact <email or URL>]` |
| `protect` | `dcm.mjs protect` after the user's production build (`--dry-run` to preview) |
| `grant` | `dcm.mjs grant --to "<name>" --scope "<what>" [--days 30]`, or `grant --verify <token>` |

Config lives in `dcm.config.json`: `owner`, `siteUrl`, `termsUrl`, `contact`, `input` (default
`dist`), `output` (default `dist-protected`), `allowedHosts` (staging and preview hosts where the
site must still run, `*.example.com` allowed), `grants`, `keyFile`, and an optional `notice` to replace
the first sentences.

## Rules

- **Never invent** the owner, site URL, terms or contact. Ask the user; the notice is a legal
  statement in their name.
- `protect` needs a build. If it says there is no build, ask the user to run theirs (e.g.
  `npm run build`); run it yourself only if they agree.
- Tell the user to deploy `dist-protected/`, to back up `.dcm/permission-key.pem`, and never to
  deploy or commit it. Suggest adding `.dcm/` and `dist-protected/` to `.gitignore`.
- **Ask about staging or preview domains before `protect`** and add them to `allowedHosts`: the
  site does not run on any host that is not the original, localhost or listed there.
- Only run `grant` when the user asks to give someone permission. Print the token for them; do not
  store it anywhere else.
- If `protect` refuses (symbolic links in the build, or an output directory it did not write),
  tell the user why; do not work around it.
- Pass options as separate words. Never add shell operators (`;`, `&&`, `|`, `>`, `$(`).

## What `protect` adds

- The notice, in a visible line at the end of every page, an HTML comment at the top of every
  page, and a banner at the top of every CSS/JS file (Subresource Integrity hashes are updated).
- Meta tags (`copyright`, `tdm-reservation`, `robots: noai, noimageai`), `rel=license`,
  `rel=canonical` and schema.org JSON-LD.
- `/.well-known/copy-permission.json`: granted permissions plus the public key that verifies
  tokens. The notice says ownership or permission is proven only with such a token.
- `robots.txt` rules for site-mirroring tools (wget, HTTrack and similar honor them by default;
  search engines are not affected).
- A host check (in `/.well-known/dcm-copy-check.js` and at the top of every JS file): on any other
  host the page shows only "This is a copy of <site> … it does not run here" with a link to the
  original, and the app does not start. Plain readable code; it sends nothing anywhere.
- `/.well-known/tdmrep.json` (W3C text-and-data-mining reservation).

Measured results: see `README.md` in the dont-copy-me repository.
