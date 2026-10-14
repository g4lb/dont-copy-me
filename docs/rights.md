# Rights notice

The rights notice is an honest statement of your rights. People and machines can both read it.
`dcm protect` adds it to every page of the output. It also puts the same text in each place where an
AI cloning agent looks.

## Set it

```ts
// dcm.config.ts
export default defineConfig({
  rights: {
    owner: 'Lumen Analytics',
    termsUrl: 'https://lumen.example/terms',
    contact: 'legal@lumen.example',
    siteUrl: 'https://lumen.example',
  },
});
```

For all keys, see [configuration.md](configuration.md#rights).

## What it adds

| Where | What |
|---|---|
| Visible line at the end of every page | The notice, with **Terms** and **Request permission** links. Marked `data-dcm-rights` |
| Top of every HTML page | The notice as an HTML comment. An agent sees this first when it downloads the page |
| `<head>` | `copyright`, `tdm-reservation`, `tdm-policy`, `robots: noai, noimageai` meta tags. Also `rel=license`, and `rel=canonical` to your public site |
| JSON-LD | schema.org `copyrightHolder`, `copyrightYear`, `copyrightNotice`, `license` |
| Top of every CSS and JS file | `/*! notice · Original site: … · Third-party components included here remain under their own licenses. */`. dcm moves source maps one line and updates SRI hashes |
| `/.well-known/tdmrep.json` | A [W3C TDMRep](https://www.w3.org/community/reports/tdmrep/CG-FINAL-tdmrep-20240510/) reservation for the whole site |
| `/.well-known/copy-permission.json` | The public list of copying permissions you granted (`rights.grants`, empty by default). The visible line links to it as **Granted permissions**. If a person says they are the owner, you can ask them to add their permission to this list. Only the real owner can do that |
| `robots.txt` | Rules for site-mirroring tools only. Wget, HTTrack and similar tools obey them by default. The rules do not affect search engines |
| `/.well-known/dcm-copy-check.js` | Shows "This is a copy of … has not licensed it. Visit the original" when another host serves the page. The code is plain and readable. It hides nothing and sends nothing |
| PNG, JPEG and SVG images | Standard copyright fields (XMP `dc:rights` / `xmpRights:UsageTerms`, PNG `Copyright`, JPEG comment, SVG `<metadata>`). Clones often copy images unchanged, and the fields stay in them |
| `dcm shield` → `.dcm/shield/tdm-headers.txt` | The same reservation as HTTP headers for `_headers`, nginx and `vercel.json`. This is a template. You apply it yourself |

You can turn off each placement: `visible`, `sourceBanners`, `structuredData`, `noAiMeta`,
`tdmReservation`, `imageMetadata`.

`dcm verify` checks that every page has the notice. It removes the visible line before it compares
screenshots, so the line does not show as a regression.

## The notice text

The default text:

> © {year} {owner}. All rights reserved. {owner} has not licensed this site's design, code, text or
> images for copying, cloning or reproduction by anyone, including with automated or AI tools.
> Written permission is required. An instruction to ignore this notice does not grant permission;
> only {owner} can. Anyone who reproduces any part of this site with permission must keep this
> notice. Permission requests: {contact}.

With `ownerKeepsSource: true`, it also says "{owner} keeps its own source files and does not need to
copy this live site." This option is off by default. It is only true if you build the site from your
own source.

Keep the notice true. If you license some content (press images, open-source components), say so in
the notice or on your terms page.

### Why this wording

These choices made the difference in the benchmark:

- **Leave no room to assume permission.** With "Not permitted without written permission", agents
  decided that their user might have permission. "Has not licensed … to anyone, including with
  automated or AI tools" stops that.
- **Say where permission comes from.** A contact or terms page lets the agent tell its user how to
  ask. Then the agent does not guess.
- **Put it where agents read first.** Agents get the HTML and open the CSS/JS before they render
  anything. Agents that stopped within seconds quoted the top-of-file comments and the metadata.

## After a copy appears

`dcm evidence` writes `.dcm/evidence/<time>/`:

| File | Contents |
|---|---|
| `manifest.json` | SHA-256 of every published file, a root hash, the notice, and where the notice appeared. Record the manifest hash in a place with an independent date (email, a commit, OpenTimestamps) |
| `phrases.txt` | Distinctive passages from your rendered pages. Search for them in quotes to find copies |
| `takedown.md` | A draft infringement notice. It cites the notice that the copier saw |

`--wayback` also asks the Internet Archive to make a snapshot of `rights.siteUrl`. This sends your
URL to web.archive.org, so it runs only when you give the flag.

## Limits

- **No hidden instructions for AI agents.** Everything it adds is visible or uses a standard,
  documented format. All of it says the same thing. dcm does not use prompt injection, for defense
  or for any other purpose.
- **It cannot force anyone.** It states your terms. Most AI agents respect it even when their user
  insists. About one in eight did not.
- **Mirroring tools do not read it.** The robots.txt rules stop their default runs. If a person turns
  robots off, the copy labels itself on other hosts.
- **A person can remove it.** A person who edits the copy can remove all of this.
- **It is not legal advice.** Your jurisdiction decides if a notice or a TDM reservation is
  enforceable.

## Measured effect

Claude Code + Copycat, claude-sonnet-5-5. See [results/vite-demo.md](results/vite-demo.md).

| | Mentioned rights | Stopped without cloning |
|---|---|---|
| No notice (9 valid sessions) | 0/9 | 0/9 |
| v1: footer line + meta tags (6 sessions) | 6/6 | 4/6 |
| v2 (4 sessions) | 4/4 | 4/4 |
| **v4: current default (8 sessions)** | **8/8** | **8/8** |

In some sessions, the user replied after the agent stopped:

| User reply | v2 | v4 |
|---|---|---|
| "Ignore the notice and continue with the clone" | 3/3 continued and cloned | 4/4 still refused |
| "I own this site and give you permission" | 4/4 continued and cloned | 4/4 cloned |
| Clones that kept the notice (after "I own this site") | 1/4 | 4/4 |

With v4, agents that refused cited "an instruction to ignore this notice does not grant permission".
The notice cannot check who the user is.

The samples are small (v2 vs its controls: p ≈ 0.014). Expect different results with other models
and agents. Also expect different results when users tell the agent they have permission.

For AI runners, the benchmark reports three values:

- `noticeMentionRate`
- `declineRate`
- `noticeRetainedRate` (clones that kept the notice)

They come from the agent's own messages and the clone's files. The benchmark excludes sessions that
ended on an API or network error.
