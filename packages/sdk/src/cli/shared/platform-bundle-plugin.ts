import type * as rolldown from "rolldown";

// Fold `process.env.TAILOR_PLATFORM_BUNDLE` to `true` so the minifier DCEs the
// test-only workflow registry/trigger shim. Apply in every bundler that builds
// runnable functions; a missed path leaves the env read in place and fails
// loudly on the Platform's Web runtime (no `process`), which an e2e catches.
export const platformBundleDefinePlugin: rolldown.Plugin = {
  name: "tailor-platform-bundle-define",
  transform(code) {
    if (!code.includes("process.env.TAILOR_PLATFORM_BUNDLE")) return null;
    return { code: code.replaceAll("process.env.TAILOR_PLATFORM_BUNDLE", "true") };
  },
};
