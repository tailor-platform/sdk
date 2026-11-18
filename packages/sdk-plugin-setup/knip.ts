import type { KnipConfig } from "knip";

export default {
  // oxlint runs tsrs-lint from node_modules/.bin but declares only oxlint-tsgolint as a peer.
  ignoreDependencies: ["tsrs"],
  // Invoked from the workflow audit test when available on PATH; not a package dependency.
  ignoreBinaries: ["knip", "publint", "zizmor"],
  treatConfigHintsAsErrors: true,
} satisfies KnipConfig;
