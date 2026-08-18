import type { KnipConfig } from "knip";

export default {
  ignoreExportsUsedInFile: true,
  ignore: ["src/__fixtures__/**"],
  ignoreBinaries: ["knip", "publint"],
} satisfies KnipConfig;
