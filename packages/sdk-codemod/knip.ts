import type { KnipConfig } from "knip";

export default {
  ignoreExportsUsedInFile: true,
  // Transform entries come from tsdown.config.ts, so a transform dropped from
  // there and from the registry surfaces as unused rather than as an entry.
  entry: ["scripts/*.ts"],
  ignore: ["codemods/**/tests/**"],
  ignoreBinaries: ["knip", "publint"],
} satisfies KnipConfig;
