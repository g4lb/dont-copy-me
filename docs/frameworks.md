# Framework integration

## Vite (supported)

Verified end to end with Vite 8 and React 19 in `examples/vite-demo`. No plugin is needed:
`npm run build && npx dcm protect` (the demo and its end-to-end test use the CLI this way). To run it
automatically after every build, use the Vite plugin:

```ts
// vite.config.ts
import { dontCopyMe } from '@dont-copy-me/framework-vite';
export default defineConfig({ plugins: [react(), dontCopyMe()] });
```

The plugin changes no build settings. After `vite build` it runs `dcm protect` with your
`dcm.config.ts` (`dontCopyMe({ protectOnBuild: false })` turns that off).

> **Deploy `dist-protected/`, not `dist/`.**

SSR output (`dist/server`) gets source banners, but no page notice: add the notice to your server
templates.

## Static sites and other bundlers (supported)

Any build that is a folder of HTML, CSS and JS works with the static adapter (`framework:
'static'`, `input: 'build'` or wherever your files are).

## Server-rendered frameworks

Not handled by `dcm protect`, which edits HTML files. Render the same notice in your layout:
`renderNotice(config.rights)` and `injectRights(html, config.rights)` from `@dont-copy-me/notice`
produce the exact text and tags.

## Adding a framework

Implement `FrameworkAdapter` from `@dont-copy-me/core` (`name`, `defaultInput`, `defaultOutput`,
`serveMode`, `detect`, optional `copyIgnore` and `urlToBuildPath`) and pass it to `resolveProject`.
