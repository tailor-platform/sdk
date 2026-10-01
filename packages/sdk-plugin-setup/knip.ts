import type { KnipConfig } from "knip";

export default {
  // Run from the release workflow through the root package.json, which knip does not trace into.
  entry: [
    "scripts/resolve-pending-template-version.ts",
    "scripts/yaml-text-loader.mjs",
    "scripts/yaml-text-hooks.mjs",
  ],
  // Invoked from the workflow lint test when available on PATH; not a package dependency.
  ignoreBinaries: ["actionlint", "knip", "publint"],
} satisfies KnipConfig;
