# Security model and limitations

## What Don't Copy Me is

Don't Copy Me puts an honest rights notice where people and automated agents look. It also gives you tools to verify the notice and to measure how cloning agents react to it.

It does not hide, encrypt, obfuscate or block anything.

## What it helps against

Someone gives an AI agent (Claude Code, Cursor, Codex, a cloning skill) your public URL. They ask the agent to recreate your site.

The notice tells the agent the truth: the site is not licensed for copying, and it says where permission comes from. Careful agents then stop and tell their user. The benchmark measures how often this occurs.

## What it cannot stop

The web works this way, so a notice cannot prevent these attacks:

| Attack | Why a notice cannot prevent it |
|---|---|
| Scripted mirroring (wget, HTTrack, `mirror` runner) | These tools do not read notices. The `mirror` runner shows this. |
| A user who tells the agent "I have permission" | Agents usually believe their user. |
| Agents or models that ignore the notice | A notice is a statement, not a technical control. |
| Visual imitation from screenshots | The pixels must get to the user. |

## Recommended layers of defense

1. **The rights notice** (`dcm protect`), with a real terms page and a contact for permission.
2. **Optional rights-declaration templates** (`dcm shield`): robots.txt for AI crawlers, TDM headers, and user-agent rules for declared crawlers. They state your terms at the HTTP layer. They do not stop a copier who ignores them.
3. **Server-side logic and data.** Keep proprietary logic and data on the server, behind authenticated APIs. Nothing in the browser is secret.
4. **Legal action** for copies that you find. The notice and the TDM reservation show that you stated your terms.

## Honesty rules

- **No hidden text and no instructions for AI models** (no prompt injection). Each copy of the notice says the same thing as the visible line.
- **No false claims.** The notice states what you configured. Do not claim enforcement that you do not have. If you license parts of the site, say so.
- **No estimated results.** dcm reports runners that did not run as not executed.

## Safety of the tool itself

See [../SECURITY.md](../SECURITY.md#built-in-safety-properties). In summary:

- No writes to sources or to the original build.
- Atomic output, with backups.
- Path confinement.
- No shell for subprocesses.
- Benchmark targets are local only. dcm blocks other origins.
- dcm uploads nothing.
- AI runs need explicit consent and have spend caps.

## Known technical limitations

- **Pages rendered at request time (SSR).** dcm edits HTML files in the build output. For SSR pages, you must put the notice in your templates.
- **Hard-coded integrity hashes outside the build's HTML** (for example, in a CDN config). When banners change file bytes, you must update these hashes.
- **`noai` meta.** This is a convention that some crawlers honor. It is not a standard. TDMRep is a W3C Community Group report, not a W3C Recommendation.
- **Loopback performance numbers.** They are relative indicators, not field measurements.
- **AI sandboxing is best effort.** It uses macOS `sandbox-exec`. Other platforms get only a separate temp directory.
- **The benchmark serves sites on 127.0.0.1.** An agent may think that a loopback site belongs to its user. This could make the agent more willing to clone than on a public domain. This bias works against the notice.
