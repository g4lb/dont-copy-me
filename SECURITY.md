# Security policy

## What Don't Copy Me guarantees, and what it does not

**A public website cannot be made uncopyable.** Don't Copy Me adds an honest rights notice for
people and AI agents and measures how agents respond. It does not:

- technically prevent copying, mirroring or visual imitation;
- stop an agent whose user claims to have permission;
- hide network calls, API endpoints, secrets or anything the server returns;
- replace server-side authorization, rate limiting or legal protection.

## Built-in safety properties

- The original build and your sources are never written to. `dcm protect` runs in a temporary
  staging directory outside the project and publishes atomically. Failures leave the previous
  output intact.
- Notice text is HTML-escaped in pages and comments, `<` is escaped in JSON-LD, and `*/` is broken
  in code banners, so a configured owner name or notice cannot inject markup or code.
- Every configurable path is resolved inside the project. Traversal (`../`) is refused, and the
  output can never overlap the input, the project root or source directories.
- External processes (framework servers, cloning tools) are spawned without a shell. Arguments are
  never interpreted as shell syntax.
- Benchmarks only target loopback servers dcm starts for your own build directories. Requests to
  other origins are blocked, and request counts and time are budgeted.
- Nothing is uploaded. Reports, screenshots and transcripts stay in `.dcm/`.
- AI clone benchmarks run only after explicit confirmation (`--yes` or an interactive prompt), with
  spend caps. On macOS they run under `sandbox-exec` with read access to the project denied (best
  effort; it is not a security boundary).
- Third-party cloning skills are never downloaded, modified or bundled. You provide local checkouts.
- Prompt-injection content is never used, as a defense or otherwise.

## Supply chain

Runtime dependencies are deliberately few: `commander`, `zod`, `jiti`, `picomatch`, `pixelmatch`,
`pngjs` (MIT/ISC) and `playwright` (Apache-2.0). Versions are locked in `pnpm-lock.yaml`. Review
updates before upgrading.

## Reporting a vulnerability

Please report vulnerabilities privately by email to **galevgi@gmail.com** with "Don't Copy Me
security" in the subject. Include a description, affected version and reproduction steps. Do not
open a public issue for security reports. You will get an acknowledgement within 7 days.
