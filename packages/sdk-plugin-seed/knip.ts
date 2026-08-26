import type { KnipConfig } from "knip";

export default {
  ignore: ["src/__fixtures__/**"],
  ignoreBinaries: ["knip", "publint"],
} satisfies KnipConfig;
