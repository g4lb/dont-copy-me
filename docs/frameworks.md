# Framework integration

## Vite (supported)

We tested Vite 8 and React 19 end to end in `examples/vite-demo`.

You do not need a plugin. Run the CLI after the build:

```bash
npm run build && npx dcm protect
```

The demo and its end-to-end test use the CLI this way.

To protect the site after every build, add the Vite plugin:

```ts
// vite.config.ts
import { dontCopyMe } from '@dont-copy-me/framework-vite';
export default defineConfig({ plugins: [react(), dontCopyMe()] });
```

- The plugin does not change build settings.
- After `vite build`, the plugin runs `dcm protect` with your `dcm.config.ts`.
- To stop this step, use `dontCopyMe({ protectOnBuild: false })`.

> **Deploy `dist-protected/`, not `dist/`.**

SSR output (`dist/server`) gets source banners but no page notice. Add the notice to your server
templates yourself.

## Static sites and other bundlers (supported)

The static adapter works with any build that is a folder of HTML, CSS and JS files. Set:

- `framework: 'static'`
- `input: 'build'`, or the folder that holds your files

## Server-rendered frameworks

`dcm protect` edits HTML files only, so it does not support these frameworks. Show the same notice
in your layout. These functions from `@dont-copy-me/notice` give the exact text and tags:

- `renderNotice(config.rights)`
- `injectRights(html, config.rights)`

## Add a framework

1. Implement `FrameworkAdapter` from `@dont-copy-me/core`. It has `name`, `defaultInput`,
   `defaultOutput`, `serveMode` and `detect`. `copyIgnore` and `urlToBuildPath` are optional.
2. Give the adapter to `resolveProject`.
