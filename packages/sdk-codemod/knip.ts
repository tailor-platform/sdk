import type { KnipConfig } from "knip";

export default {
  // Transform entries come from tsdown.config.ts, so a transform dropped from
  // there and from the registry surfaces as unused rather than as an entry.
  entry: ["scripts/*.ts"],
  ignore: ["codemods/**/tests/**"],
  // oxlint runs tsrs-lint from node_modules/.bin but declares only oxlint-tsgolint as a peer.
  ignoreDependencies: ["tsrs"],
  ignoreBinaries: ["knip", "publint"],
  treatConfigHintsAsErrors: true,
} satisfies KnipConfig;
