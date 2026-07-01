import { entry } from "./tsdown.config";
import type { KnipConfig } from "knip";

// knip's tsdown plugin can't statically read the entry list from a two-pass
// array config, so the build entries are imported directly from tsdown.config.
export default {
  ignoreExportsUsedInFile: true,
  tags: ["-lintignore"],
  entry: [...entry],
  ignore: [
    "scripts/**",
    "e2e/fixtures/**",
    "eslint-rules/__tests__/fixtures/**",
    "src/cli/commands/deploy/__test_fixtures__/**",
    "src/cli/commands/tailordb/erd/viewer-assets/**",
    "src/types/*.ts",
    "src/vitest/integration/vitest.config.ts",
    "zinfer.config.ts",
  ],
  ignoreDependencies: ["undici", "vite"],
  ignoreBinaries: ["knip", "publint", "actionlint"],
} satisfies KnipConfig;
