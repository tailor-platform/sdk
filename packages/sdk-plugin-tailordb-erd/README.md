# @tailor-platform/sdk-plugin-tailordb-erd

Tailor CLI plugin that provides the `tailor tailordb erd` commands: export, diff, serve, and deploy a TailorDB ERD viewer built from your local TailorDB schema.

> [!NOTE]
> This package is primarily a **CLI plugin**: it ships an external `tailor-tailordb-erd` executable that the Tailor CLI dispatches to when you run `tailor tailordb erd`. It also ships a small config plugin, `tailordbErdPlugin`, used only to configure deploy targets via `definePlugins()` in `tailor.config.ts`.

## Installation

Install it next to `@tailor-platform/sdk` in your project:

```bash
npm install -D @tailor-platform/sdk-plugin-tailordb-erd
```

The Tailor CLI discovers the plugin automatically from `node_modules/.bin` (or your `PATH`). Run `tailor plugin list` to confirm it resolves.

## Usage

```bash
# Build the ERD viewer for a namespace into .tailor/erd/<namespace>/dist
tailor tailordb erd export --namespace my-db

# Serve the ERD viewer locally with watch reload
tailor tailordb erd serve --namespace my-db --open

# Render an HTML diff between two exported ERD viewers
tailor tailordb erd diff --base-html base.html --head-html head.html -o diff.html

# Deploy the ERD viewer to the static website configured in `tailordbErdPlugin({ sites })`
tailor tailordb erd deploy --namespace my-db
```

`deploy` publishes to the static website configured for each namespace via `tailordbErdPlugin({ sites })` in your `tailor.config.ts`:

```ts
import { definePlugins } from "@tailor-platform/sdk";
import { tailordbErdPlugin } from "@tailor-platform/sdk-plugin-tailordb-erd";

export const plugins = definePlugins(
  // TailorDB namespace name → static website name
  tailordbErdPlugin({ sites: { "my-db": "my-erd-site" } }),
);
```

Each site name must match a static website defined in `staticWebsites` in the same config.

Run `tailor tailordb erd <command> --help` for the full option reference.
