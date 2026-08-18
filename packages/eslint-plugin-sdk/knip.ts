import type { KnipConfig } from "knip";

export default {
  ignoreExportsUsedInFile: true,
  ignoreBinaries: ["knip", "publint"],
} satisfies KnipConfig;
