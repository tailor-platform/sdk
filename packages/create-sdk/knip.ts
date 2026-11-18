import type { KnipConfig } from "knip";

export default {
  // Scaffold sources shipped to user projects; they have their own entry points.
  ignore: ["templates/**"],
  // oxlint runs tsrs-lint from node_modules/.bin but declares only oxlint-tsgolint as a peer.
  ignoreDependencies: ["tsrs"],
  ignoreBinaries: ["knip", "publint"],
  treatConfigHintsAsErrors: true,
} satisfies KnipConfig;
