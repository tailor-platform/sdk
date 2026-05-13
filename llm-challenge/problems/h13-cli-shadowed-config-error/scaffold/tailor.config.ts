import { defineConfig } from "@tailor-platform/sdk";

// BUG: `defineConfig(...)` is correct, but it is exported under a named
// binding instead of as the default export, so the SDK config loader
// surfaces:
//   Error: Invalid Tailor config module: default export not found
// when `pnpm tailor-sdk generate` runs against this file.
//
// Fix this file so `defineConfig({ ... })` is itself the default export.
export const config = defineConfig({
  name: "micro-challenge",
  db: {
    tailordb: {
      files: ["./tailordb/*.ts"],
    },
  },
});
