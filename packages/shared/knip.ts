import type { KnipConfig } from "knip";

export default {
  ignoreExportsUsedInFile: true,
  ignoreBinaries: ["knip", "oxlint", "tsc"],
} satisfies KnipConfig;
