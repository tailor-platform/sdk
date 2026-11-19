import type { KnipConfig } from "knip";

export default {
  entry: ["client/function-run/main.tsx"],
  ignoreBinaries: ["knip", "publint"],
  treatConfigHintsAsErrors: true,
} satisfies KnipConfig;
