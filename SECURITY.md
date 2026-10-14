# Security policy

## What Don't Copy Me does and does not do

**Nobody can make a public website impossible to copy.** Don't Copy Me adds an honest rights
notice for people and AI agents. It also measures how agents respond to the notice.

It does not:

- prevent copying, mirroring or visual imitation by technical means.
- stop an agent whose user says they have permission.
- hide network calls, API endpoints, secrets or any data that the server returns.
- replace server-side authorization, rate limiting or legal protection.

## Built-in safety properties

- **Your files stay unchanged.** dcm never writes to the original build or to your sources.
  - `dcm protect` works in a temporary staging directory outside the project.
  - It publishes the output atomically.
  - If it fails, the previous output stays as it was.
- **No injection.** A configured owner name or notice cannot inject markup or code, because:
  - dcm HTML-escapes the notice text in pages and comments.
  - dcm escapes `<` in JSON-LD.
  - dcm breaks `*/` in code banners.
- **Paths stay inside the project.** dcm resolves every configurable path inside the project.
  - It refuses traversal (`../`).
  - The output can never overlap the input, the project root or source directories.
- **No shell.** dcm starts external processes (framework servers, cloning tools) without a shell.
  It never reads arguments as shell syntax.
- **Local targets only.** Benchmarks target only the loopback servers that dcm starts for your own
  build directories.
  - dcm blocks requests to other origins.
  - Request counts and time have budgets.
- **No uploads.** Reports, screenshots and transcripts stay in `.dcm/`.
- **Consent for AI benchmarks.** AI clone benchmarks run only after you confirm (`--yes` or an
  interactive prompt). They have spend caps.
  - On macOS they run under `sandbox-exec`, which denies read access to the project.
  - This is best effort. It is not a security boundary.
- **No third-party skills in the package.** dcm never downloads, changes or bundles third-party
  cloning skills. You supply local checkouts.
- **No prompt injection.** dcm never uses prompt-injection content, as a defense or for any other
  purpose.

## Supply chain

We keep runtime dependencies few on purpose:

- `commander`, `zod`, `jiti`, `picomatch`, `pixelmatch`, `pngjs` (MIT/ISC)
- `playwright` (Apache-2.0)

`pnpm-lock.yaml` locks the versions. Review each update before you upgrade.

## Report a vulnerability

Send vulnerability reports privately by email to **galevgi@gmail.com**. Put "Don't Copy Me
security" in the subject.

Include:

- a description
- the affected version
- the steps to reproduce

Do not open a public issue for a security report. You will get an acknowledgement within 7 days.
