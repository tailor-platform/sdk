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
    "src/vitest/integration/vitest.config.ts",
    "src/vitest/integration/fixtures/tailor.config.ts",
    "src/vitest/integration/fixtures/user-setup-probe.ts",
  ],
  ignoreIssues: {
    "src/runtime/{aigateway,authconnection,context,file,iconv,idp,secretmanager,workflow}.ts": [
      "duplicates",
    ],
    // zinfer reads every exported *Schema from its include files.
    ...Object.fromEntries((zinferConfig.include ?? []).map((glob) => [glob, ["exports"]])),
    // zinfer emits an input and an output type for every schema, used or not.
    "src/types/*.generated.ts": ["types"],
  },
  // migration-model.test.ts runs Quint's CLI by its resolved path, which knip does not trace.
  ignoreDependencies: ["@informalsystems/quint"],
  ignoreBinaries: ["knip", "publint"],
  treatConfigHintsAsErrors: true,
} satisfies KnipConfig;
