import type { KnipConfig } from "knip";

export default {
  // Invoked from the workflow lint test when available on PATH; not a package dependency.
  ignoreBinaries: ["aqua", "knip", "publint"],
} satisfies KnipConfig;
