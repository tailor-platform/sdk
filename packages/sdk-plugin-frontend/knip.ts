import type { KnipConfig } from "knip";

export default {
  ignoreBinaries: ["knip", "publint"],
  treatConfigHintsAsErrors: true,
} satisfies KnipConfig;
