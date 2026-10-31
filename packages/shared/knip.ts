import type { KnipConfig } from "knip";

export default {
  ignoreBinaries: ["knip", "tsc"],
  treatConfigHintsAsErrors: true,
} satisfies KnipConfig;
