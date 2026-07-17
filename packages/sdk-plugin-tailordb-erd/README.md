# @tailor-platform/sdk-plugin-tailordb-erd

Tailor CLI plugin that provides the `tailor tailordb erd` commands: export, diff, serve, and deploy a TailorDB ERD viewer built from your local TailorDB schema.

> [!NOTE]
> This package is a **CLI plugin**: it ships an external `tailor-tailordb-erd` executable that the Tailor CLI dispatches to when you run `tailor tailordb erd`. It is not a config plugin — do not pass it to `definePlugins()` in `tailor.config.ts`.

## Installation

Install it next to `@tailor-platform/sdk` in your project:

```bash
npm install -D @tailor-platform/sdk-plugin-tailordb-erd@next
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

# Deploy the ERD viewer to the static website configured as `erdSite`
tailor tailordb erd deploy --namespace my-db
```

`deploy` publishes to the static website referenced by `erdSite` in your `tailor.config.ts`:

```ts
db: {
  "my-db": {
    files: ["tailordb/*.ts"],
    erdSite: "my-erd-site",
  },
},
```

Run `tailor tailordb erd <command> --help` for the full option reference.
