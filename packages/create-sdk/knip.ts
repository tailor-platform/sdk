import type { KnipConfig } from "knip";

export default {
  // Scaffold sources shipped to user projects; they have their own entry points.
  ignore: ["templates/**"],
  ignoreBinaries: ["knip", "publint"],
} satisfies KnipConfig;
