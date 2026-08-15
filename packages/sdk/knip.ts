import { entry } from "./scripts/build-entries.mjs";
import type { KnipConfig } from "knip";

export default {
  ignoreExportsUsedInFile: true,
  tags: ["-lintignore"],
  entry: [...entry],
  ignore: [
    "scripts/**",
    "e2e/fixtures/**",
    "src/cli/**/__test_fixtures__/**",
    "src/cli/ts-hook.d.mts",
    "src/types/*.ts",
    "src/vitest/integration/vitest.config.ts",
    "vinfer.config.ts",
  ],
  ignoreIssues: {
    "src/runtime/{aigateway,authconnection,context,file,iconv,idp,secretmanager,workflow}.ts": [
      "duplicates",
    ],
  },
  ignoreBinaries: ["knip", "publint", "actionlint"],
} satisfies KnipConfig;
