import { entry } from "./scripts/build-entries.mjs";
import type { KnipConfig } from "knip";

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
  ignoreBinaries: ["knip", "publint", "actionlint"],
} satisfies KnipConfig;
