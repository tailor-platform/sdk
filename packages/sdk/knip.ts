import { entry } from "./scripts/build-entries.mjs";
import type { KnipConfig } from "knip";

// Share the build entry list with tsdown and the declaration build script.
export default {
  ignoreExportsUsedInFile: true,
  tags: ["-lintignore"],
  entry: [...entry],
  ignore: [
    "scripts/**",
    "e2e/fixtures/**",
    "src/cli/commands/deploy/__test_fixtures__/**",
    "src/cli/commands/tailordb/erd/viewer-assets/**",
    "src/types/*.ts",
    "src/vitest/integration/vitest.config.ts",
    "zinfer.config.ts",
  ],
  ignoreDependencies: ["vite"],
  ignoreBinaries: ["knip", "publint", "actionlint"],
} satisfies KnipConfig;
