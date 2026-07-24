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
    "src/cli/ts-hook.d.mts",
    // Bin shim copied verbatim to dist/cli/index.mjs (tsdown.config.ts); its
    // `./main.mjs` import only resolves post-build, not in src/.
    "src/cli/index.mjs",
    "src/types/*.ts",
    "src/vitest/integration/vitest.config.ts",
    "zinfer.config.ts",
  ],
  ignoreIssues: {
    "src/runtime/{aigateway,authconnection,context,file,iconv,idp,secretmanager,workflow}.ts": [
      "duplicates",
    ],
  },
  ignoreDependencies: ["undici", "vite"],
  ignoreBinaries: ["knip", "publint", "actionlint"],
} satisfies KnipConfig;
