import { entry } from "./tsdown.config";
import type { KnipConfig } from "knip";

// knip's tsdown plugin can't statically read the entry list from this
// multi-config tsdown setup, so import the build entries directly.
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
