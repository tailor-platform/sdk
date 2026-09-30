# Frontend Plugin

`frontendPlugin` builds frontend assets and uploads them to Static Websites after
`tailor deploy` applies your application. It can provide deployed URLs and public
OAuth client IDs as build environment variables.

## Monorepo example

Given this layout:

```text
apps/
  backend/
    tailor.config.ts
  web/
    package.json
    dist/
```

Register the plugin in `apps/backend/tailor.config.ts`:

```typescript
import { defineConfig, definePlugins, defineStaticWebSite } from "@tailor-platform/sdk";
import { frontendPlugin } from "@tailor-platform/sdk/plugin/frontend";

const website = defineStaticWebSite("my-frontend", { description: "Web app" });

export default defineConfig({
  name: "my-app",
  staticWebsites: [website],
});

export const plugins = definePlugins(
  frontendPlugin({
    site: website,
    workingDir: "../web",
    build: "pnpm run build",
    distDir: "dist",
    env: ({ site, application }) => ({
      VITE_TAILOR_APP_URL: application.url,
      VITE_SITE_URL: site.url,
      VITE_OAUTH2_CLIENT_ID:
        application.auth?.oauth2Clients.find((client) => client.name === "web")?.clientId ?? "",
    }),
  }),
);
```

Run `tailor deploy --config apps/backend/tailor.config.ts` from the repository
root. `workingDir` is where `build` runs, relative to the config's directory, so
this example builds in `apps/web`. `distDir` is the directory your build writes
its assets to, relative to `workingDir`, so this example publishes `apps/web/dist`.
Set it to match your build tool's output setting; the plugin does not change where
the build writes. Omitting `workingDir` uses the config's directory. Absolute paths are
also accepted.

`site` accepts either a `defineStaticWebSite()` result or a site name. The site
must be declared by a config included in the deploy. With multiple configs,
`site` may refer to any of their websites.

## Build environment

`env` is an optional function that returns environment variables, synchronously
or asynchronously. Its values override matching variables inherited from the
parent process. Choose variable names for your frontend framework; the plugin
does not add a prefix.

The callback receives the destination `site`, the registering `application`, all
`applications` in the deploy, `staticWebsites` indexed by name, and `workspaceId`.
Only public OAuth client IDs are provided. Values embedded into browser assets
are visible to visitors, so supply only values intended for public use.

Build commands run in a shell. Their stdout and stderr both go to stderr, keeping
`tailor deploy --json` stdout available for the JSON result. Builds have no timeout.

## Upload existing assets

Omit `build` to upload an existing directory:

```typescript
export const plugins = definePlugins(
  frontendPlugin({ site: "my-frontend", workingDir: "../web", distDir: "dist" }),
);
```

For multiple frontends, pass each one as another argument, as in
`frontendPlugin(web, admin)`; register the plugin only once. Each site may appear
only once. Frontends are built and uploaded sequentially, in argument order. At
least one frontend is required, and each `distDir` must be non-empty. A `build` that is empty or only whitespace is rejected; omit `build` instead to publish without building.

## Deploy behavior and failures

The plugin runs even if no platform resources changed. It does not run during
dry-run, build-only, generation, or migration test deployments. Dry-run lists the
plugin as a pending deploy hook.

An unknown site, failed build, missing output directory, or failed upload stops
later frontends and deploy hooks. Platform resources have already been applied;
fix the error and run `tailor deploy` again. Successfully uploaded frontends are
not rolled back. Skipped upload files produce warnings and are listed in the result.

With `--json`, the result contains a `deployedHooks` entry for
`@tailor-platform/frontend`. Its `outputs.frontends` array contains each site's
`site`, published `url`, and `skippedFiles`.
