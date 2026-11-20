import type { KnipConfig } from "knip";

export default {
  // oxlint runs tsrs-lint from node_modules/.bin but declares only oxlint-tsgolint as a peer.
  ignoreDependencies: ["tsrs"],
  ignoreBinaries: ["knip", "tsc"],
  treatConfigHintsAsErrors: true,
} satisfies KnipConfig;
