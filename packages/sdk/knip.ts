import { entry } from "./scripts/build-entries.mjs";
import type { KnipConfig } from "knip";

export default {
  tags: ["-lintignore"],
  entry: [...entry],
  ignore: [
    "scripts/**",
    "e2e/fixtures/**",
    "src/cli/**/__test_fixtures__/**",
    "src/cli/ts-hook.d.mts",
    "src/types/*.ts",
    "src/vitest/integration/vitest.config.ts",
    "zinfer.config.ts",
  ],
  ignoreIssues: {
    "src/runtime/{aigateway,authconnection,context,file,iconv,idp,secretmanager,workflow}.ts": [
      "duplicates",
    ],
    // zinfer reads every exported *Schema from these files (see zinfer.config.ts).
    "src/parser/**/schema.ts": ["exports"],
  },
  ignoreBinaries: ["knip", "publint", "actionlint"],
} satisfies KnipConfig;
