import type { KnipConfig } from "knip";

export default {
  // Copied into dist by tsdown.config.ts and read at runtime, never imported.
  ignore: ["src/viewer-assets/**"],
  ignoreBinaries: ["knip", "publint"],
} satisfies KnipConfig;
