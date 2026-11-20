import type { KnipConfig } from "knip";

export default {
  ignore: [
    // Copied into dist by tsdown.config.ts and read at runtime, never imported.
    "src/viewer-assets/**",
    "src/__fixtures__/**",
  ],
  // oxlint runs tsrs-lint from node_modules/.bin but declares only oxlint-tsgolint as a peer.
  ignoreDependencies: ["tsrs"],
  ignoreBinaries: ["knip", "publint"],
  treatConfigHintsAsErrors: true,
} satisfies KnipConfig;
