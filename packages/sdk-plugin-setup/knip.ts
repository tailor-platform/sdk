import type { KnipConfig } from "knip";

export default {
  // Invoked from the workflow audit test when available on PATH; not a package dependency.
  ignoreBinaries: ["knip", "publint", "zizmor"],
} satisfies KnipConfig;
