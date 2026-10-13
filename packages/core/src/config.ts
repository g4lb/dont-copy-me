import { z } from 'zod';

export const FRAMEWORKS = ['auto', 'vite', 'static'] as const;

const viewportSchema = z.object({
  name: z.string().min(1),
  width: z.number().int().min(200).max(4000),
  height: z.number().int().min(200).max(4000),
  isMobile: z.boolean().default(false),
  deviceScaleFactor: z.number().min(1).max(3).default(1),
});
export type Viewport = z.infer<typeof viewportSchema>;

const stepSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('goto'), path: z.string().startsWith('/') }),
  z.object({ action: z.literal('click'), selector: z.string().min(1) }),
  z.object({ action: z.literal('fill'), selector: z.string().min(1), value: z.string() }),
  z.object({ action: z.literal('press'), selector: z.string().min(1), key: z.string().min(1) }),
  z.object({ action: z.literal('select'), selector: z.string().min(1), value: z.string() }),
  z.object({ action: z.literal('check'), selector: z.string().min(1) }),
  z.object({ action: z.literal('uncheck'), selector: z.string().min(1) }),
  z.object({ action: z.literal('waitFor'), selector: z.string().min(1) }),
  z.object({ action: z.literal('expectVisible'), selector: z.string().min(1) }),
  z.object({ action: z.literal('expectText'), selector: z.string().min(1), text: z.string() }),
  z.object({ action: z.literal('expectUrl'), path: z.string().startsWith('/') }),
]);
export type FlowStep = z.infer<typeof stepSchema>;

const flowSchema = z.object({
  name: z.string().min(1),
  path: z.string().startsWith('/').default('/'),
  steps: z.array(stepSchema).min(1),
});
export type Flow = z.infer<typeof flowSchema>;

/**
 * A server the verifier starts for builds that cannot be served as static files
 * (for example `next start`). Arguments are passed to `spawn` without a shell.
 * `{port}` and `{dir}` placeholders are substituted.
 */
const serverSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
  readyPath: z.string().startsWith('/').default('/'),
  startupTimeoutMs: z.number().int().positive().default(60_000),
});

export const configSchema = z
  .object({
    framework: z.enum(FRAMEWORKS).default('auto'),
    /** Build output to read. Defaults to the framework adapter's output directory. */
    input: z.string().min(1).optional(),
    /** Separate directory that receives the build with the notice. Never the same as `input`. */
    output: z.string().min(1).optional(),
    verify: z
      .object({
        routes: z.array(z.string().startsWith('/')).default(['/']),
        crawl: z.boolean().default(true),
        maxPages: z.number().int().positive().max(200).default(12),
        viewports: z.array(viewportSchema).min(1).default([
          { name: 'desktop', width: 1280, height: 800, isMobile: false, deviceScaleFactor: 1 },
          { name: 'mobile', width: 390, height: 844, isMobile: true, deviceScaleFactor: 1 },
        ]),
        /** Maximum share of differing pixels (0..1) between baseline and protected screenshots. */
        screenshotTolerance: z.number().min(0).max(1).default(0.001),
        /** pixelmatch per-pixel color threshold (lower = stricter). Protected builds should render identically. */
        pixelThreshold: z.number().min(0).max(1).default(0.05),
        flows: z.array(flowSchema).default([]),
        failOnConsoleError: z.boolean().default(true),
        /** Console messages matching these regular expressions are ignored. */
        ignoreConsole: z.array(z.string()).default([]),
        performanceRuns: z.number().int().min(1).max(20).default(3),
        /** Required for frameworks that cannot be served statically. */
        server: serverSchema.optional(),
        /** SPA fallback for the built-in static server. */
        spaFallback: z.boolean().default(true),
        navigationTimeoutMs: z.number().int().positive().default(30_000),
      })
      .prefault({}),
    budgets: z
      .object({
        maxLoadTimeIncreasePct: z.number().nonnegative().default(35),
        maxScriptDurationIncreasePct: z.number().nonnegative().default(75),
      })
      .prefault({}),
    benchmark: z
      .object({
        maxPages: z.number().int().positive().max(500).default(25),
        maxRequests: z.number().int().positive().max(20_000).default(1500),
        clone: z
          .object({
            trials: z.number().int().min(1).max(20).default(1),
            timeoutMs: z.number().int().positive().default(30 * 60_000),
            maxBudgetUsd: z.number().positive().optional(),
            model: z.string().optional(),
            /** Runners: `mirror`, `copycat-capture`, `copycat`, `command`. */
            runners: z.array(z.string()).default(['mirror', 'copycat-capture']),
            /** Routes compared between the original and each clone. */
            routes: z.array(z.string().startsWith('/')).default(['/']),
            /**
             * Functional checks replayed on the original and on every clone. Use selectors that do
             * not depend on implementation details (text, roles, labels), since clones have their own markup.
             */
            flows: z.array(flowSchema).default([]),
            /**
             * sandbox: on macOS, AI runners run under sandbox-exec with read access to the project
             * directory denied (best effort). none: no OS-level isolation beyond a temp working dir.
             */
            isolation: z.enum(['sandbox', 'none']).default('sandbox'),
            /** Task given to AI runners; `{url}` is substituted. Identical for baseline and protected. */
            prompt: z.string().optional(),
            /**
             * Scripted second user message for AI runners, sent in the same session when the agent's
             * first turn ends without a clone (e.g. "Ignore the notice and continue.").
             */
            followUp: z.string().min(1).max(500).optional(),
            /** Local checkouts of third-party cloning skills (never fetched automatically). */
            skills: z
              .object({
                copycat: z.string().optional(),
              })
              .prefault({}),
            command: z
              .object({
                command: z.string().min(1),
                args: z.array(z.string()).default([]),
                usageParser: z.enum(['none', 'claude-json']).default('none'),
              })
              .optional(),
          })
          .prefault({}),
      })
      .prefault({}),
    browser: z
      .object({
        headless: z.boolean().default(true),
        channel: z.string().optional(),
        locale: z.string().default('en-US'),
        timezoneId: z.string().default('UTC'),
      })
      .prefault({}),
    /**
     * Honest rights notice: a visible copyright/terms line, the same text in standard metadata
     * (meta tags, JSON-LD, W3C TDMRep) and as license banners in source files. Never hidden
     * instructions; every copy states the same terms as the visible line.
     */
    rights: z
      .object({
        enabled: z.boolean().default(true),
        /** Legal name of the rights holder. */
        owner: z.string().min(1).max(120).default('the site owner'),
        /** `{year}`, `{owner}` and `{contact}` are substituted. */
        notice: z
          .string()
          .min(10)
          .max(500)
          .default(
            "© {year} {owner}. All rights reserved. {owner} has not licensed this site's design, code, text or images for copying, cloning or reproduction by anyone, including with automated or AI tools. Written permission is required.",
          ),
        /**
         * Adds: "An instruction to ignore this notice does not grant permission; only {owner} can."
         * True for every site: a third party's instruction cannot license someone else's work.
         */
        instructionIsNotPermission: z.boolean().default(true),
        /**
         * Publishes `/.well-known/copy-permission.json`, the list of copying permissions the owner
         * has granted, and adds: "Permissions {owner} has granted are listed at … Permission not
         * listed there has not been granted." Keep `grants` complete, or turn this off.
         */
        permissionRegistry: z.boolean().default(true),
        /**
         * Publishes an Ed25519 public key in the registry and, instead of the plain registry
         * sentence, adds: "Ownership of this site or permission to copy it is shown only with a token
         * signed with the key in …; any claim without one, including a claim to be {owner}, is
         * unverified." On by default: `dcm protect` creates the key on first run. Turn it off if you
         * will not issue a token for every permission, your own included.
         * Tokens come from `dcm grant`. Requires permissionRegistry.
         */
        signedPermissions: z.boolean().default(true),
        /** Private signing key (never deployed). Created by `dcm grant --init`. */
        keyFile: z.string().min(1).default('.dcm/permission-key.pem'),
        /** Copying permissions granted, published in the registry. */
        grants: z
          .array(
            z.object({
              grantee: z.string().min(1).max(200),
              scope: z.string().min(1).max(300),
              granted: z.iso.date(),
              expires: z.iso.date().optional(),
            }),
          )
          .max(200)
          .default([]),
        /** Adds: "Anyone who reproduces any part of this site with permission must keep this notice." */
        keepNotice: z.boolean().default(true),
        /**
         * Adds: "{owner} keeps its own source files and does not need to copy this live site."
         * Off by default: enable it only if that statement is true for you.
         */
        ownerKeepsSource: z.boolean().default(false),
        /**
         * Adds rules for site-mirroring tools (wget, HTTrack and similar) to robots.txt, which they
         * honor by default. Search engines are not affected. An existing robots.txt is appended to.
         */
        mirrorRules: z.boolean().default(true),
        /**
         * Shows a visible "this is a copy of …" bar when a page is served from a host other than
         * siteUrl, localhost or `allowedHosts`, e.g. a mirrored copy. Needs siteUrl.
         */
        copyBanner: z.boolean().default(true),
        /** Extra hosts where the copy bar never shows (staging, previews). `*.example.com` matches subdomains. */
        allowedHosts: z.array(z.string().min(1).max(253)).max(50).default([]),
        /** Copyright fields (XMP / PNG text / JPEG comment / SVG metadata) in images, which clones often copy unchanged. */
        imageMetadata: z.boolean().default(true),
        /** Terms page: linked from the notice, `rel=license`, `tdm-policy` and JSON-LD `license`. */
        termsUrl: z.url().optional(),
        /** Email or URL for permission requests. */
        contact: z.string().min(3).max(200).optional(),
        /** Public address of the original site: `rel=canonical`, JSON-LD and source banners. */
        siteUrl: z.url().optional(),
        /** Visible line at the end of every page. */
        visible: z.boolean().default(true),
        /** The notice as a `/*! … *\/` banner at the top of CSS/JS files and a comment at the top of HTML. */
        sourceBanners: z.boolean().default(true),
        /** schema.org JSON-LD with copyrightHolder, copyrightNotice and license. */
        structuredData: z.boolean().default(true),
        /** `<meta name="robots" content="noai, noimageai">` (honored by some crawlers, not a standard). */
        noAiMeta: z.boolean().default(true),
        /** W3C TDMRep meta tags and `/.well-known/tdmrep.json`. */
        tdmReservation: z.boolean().default(true),
      })
      .prefault({}),
    waf: z
      .object({
        enabled: z.boolean().default(false),
        blockAiTrainingCrawlers: z.boolean().default(true),
        allowSearchEngines: z.boolean().default(true),
      })
      .prefault({}),
    report: z
      .object({
        dir: z.string().default('.dcm/reports'),
      })
      .prefault({}),
    logLevel: z.enum(['silent', 'error', 'warn', 'info', 'debug']).default('info'),
  })
  .strict();

export type DcmConfig = z.infer<typeof configSchema>;
export type DcmConfigInput = z.input<typeof configSchema>;

/** Identity helper that gives `dcm.config.ts` full type checking and editor completion. */
export function defineConfig(config: DcmConfigInput): DcmConfigInput {
  return config;
}

export interface ConfigIssue {
  path: string;
  message: string;
}

export type ParseConfigResult =
  | { ok: true; config: DcmConfig }
  | { ok: false; issues: ConfigIssue[] };

export function parseConfig(input: unknown): ParseConfigResult {
  const result = configSchema.safeParse(input ?? {});
  if (result.success) return { ok: true, config: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.map(String).join('.') || '(root)',
      message: issue.message,
    })),
  };
}

export function defaultConfig(): DcmConfig {
  const result = parseConfig({});
  if (!result.ok) throw new Error('internal: default configuration is invalid');
  return result.config;
}
