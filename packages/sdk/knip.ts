import { entry } from "./scripts/build-entries.mjs";
import zinferConfig from "./zinfer.config";
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
  ],
  ignoreIssues: {
    "src/runtime/{aigateway,authconnection,context,file,iconv,idp,secretmanager,workflow}.ts": [
      "duplicates",
    ],
    // zinfer reads every exported *Schema from its include files.
    ...Object.fromEntries((zinferConfig.include ?? []).map((glob) => [glob, ["exports"]])),
  },
  ignoreBinaries: ["knip", "publint"],
} satisfies KnipConfig;
