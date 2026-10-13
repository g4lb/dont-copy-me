# Security model and limitations

## What Don't Copy Me is

An honest rights notice, placed where people and automated agents look, plus tools to verify it
and to measure how cloning agents respond. It does not hide, encrypt, obfuscate or block anything.

**In scope.** An AI agent (Claude Code, Cursor, Codex, a cloning skill) is given your public URL by
someone else and asked to recreate your site. The notice tells the agent, truthfully, that the site
is not licensed for copying and where permission comes from. Careful agents then stop and tell their
user. The benchmark measures how often that happens.

**Out of scope, by nature of the web:**

| Attack | Why a notice cannot prevent it |
|---|---|
| Scripted mirroring (wget, HTTrack, `mirror` runner) | Tools don't read notices; the `mirror` runner confirms this |
| A user who tells the agent "I have permission" | Agents generally take their user's word for it |
| Agents or models that ignore the notice | A notice is a statement, not a technical control |
| Visual imitation from screenshots | Pixels must reach the user |

## Recommended layered defense

1. The rights notice (`dcm protect`), with a real terms page and a contact for permission.
2. Optional rights-declaration templates (`dcm shield`): robots.txt for AI crawlers, TDM headers,
   user-agent rules for declared crawlers. They state your terms at the HTTP layer. They do not stop
   a copier who ignores them.
3. Proprietary logic and data on the server behind authenticated APIs. Nothing in the browser is secret.
4. Legal follow-up for copies you find. The notice and TDM reservation document that your terms
   were stated.

## Honesty constraints

- No hidden text and no instructions aimed at AI models (no prompt injection). Every copy of the
  notice says what the visible line says.
- No false claims: the notice states what you configured. Don't claim enforcement you don't have,
  and say so if you license parts of the site.
- Results are never estimated. Runners that did not run are reported as not executed.

## Safety properties of the tool itself

See [../SECURITY.md](../SECURITY.md#built-in-safety-properties). Summary: no writes to sources or the
original build, atomic output with backups, path confinement, no shell for subprocesses, local-only
benchmark targets with other origins blocked, nothing uploaded, and explicit consent plus spend caps
for AI runs.

## Known technical limitations

- **Pages rendered at request time** (SSR) need the notice in your templates; dcm edits HTML files
  in the build output.
- **Hard-coded integrity hashes** outside the build's HTML (for example in a CDN config) must be
  updated when banners change file bytes.
- **`noai` meta** is a convention some crawlers honor, not a standard. TDMRep is a W3C Community
  Group report, not a W3C Recommendation.
- **Loopback performance numbers** are relative indicators, not field measurements.
- **AI sandboxing is best effort** (macOS `sandbox-exec`). Other platforms only get a separate temp directory.
- **The benchmark serves sites on 127.0.0.1.** An agent may reason that a loopback site belongs to
  its user, which could make it more willing to clone than it would be on a public domain. This bias
  works against the notice.
