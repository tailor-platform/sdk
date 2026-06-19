import type * as rolldown from "rolldown";

// Match the exact `process.env.TAILOR_PLATFORM_BUNDLE` member-expression: the
// leading lookbehind rejects a longer owner (`foo.process.env…`) or identifier,
// the trailing `\b` rejects a longer key (`…_BUNDLE_MODE`).
const GATE = /(?<![\w$.])process\.env\.TAILOR_PLATFORM_BUNDLE\b/g;

// Fold the gate to `true` so the minifier DCEs the test-only workflow
// registry/serialize runner. Apply in every bundler that builds runnable
// functions; a missed path leaves the env read in place and fails loudly on the
// Platform's Web runtime (no `process`), which an e2e catches. rolldown exposes
// no `define`, so this is a transform-level replace rather than a define.
export const platformBundleDefinePlugin: rolldown.Plugin = {
  name: "tailor-platform-bundle-define",
  transform(code) {
    if (!code.includes("process.env.TAILOR_PLATFORM_BUNDLE")) return null;
    return { code: code.replace(GATE, "true") };
  },
};
