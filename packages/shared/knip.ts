import type { KnipConfig } from "knip";

export default {
  ignoreExportsUsedInFile: true,
  ignoreBinaries: ["knip", "tsc"],
} satisfies KnipConfig;
