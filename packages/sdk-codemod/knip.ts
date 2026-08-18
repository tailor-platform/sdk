import type { KnipConfig } from "knip";

export default {
  ignoreExportsUsedInFile: true,
  entry: ["scripts/*.ts", "codemods/**/scripts/*.ts"],
  ignore: ["codemods/**/tests/**"],
  ignoreBinaries: ["knip", "publint"],
} satisfies KnipConfig;
