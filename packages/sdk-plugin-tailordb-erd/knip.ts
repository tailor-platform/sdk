import type { KnipConfig } from "knip";

export default {
  // Copied into dist by tsdown.config.ts and read at runtime, never imported.
  ignore: ["src/viewer-assets/**"],
  // oxlint runs tsrs-lint from node_modules/.bin but declares only oxlint-tsgolint as a peer.
  ignoreDependencies: ["tsrs"],
  ignoreBinaries: ["knip", "publint"],
  treatConfigHintsAsErrors: true,
} satisfies KnipConfig;
