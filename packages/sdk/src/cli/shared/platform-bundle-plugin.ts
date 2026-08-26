import type * as rolldown from "rolldown";

// Match the exact `process.env.__TAILOR_PLATFORM_BUNDLE` member-expression: the
// leading lookbehind rejects a longer owner (`foo.process.env…`) or identifier,
// the trailing `\b` rejects a longer key (`…_BUNDLE_MODE`).
const GATE = /(?<![\w$.])process\.env\.__TAILOR_PLATFORM_BUNDLE\b/g;

// Fold the gate to `true` so the minifier DCEs the test-only workflow
// registry/serialize runner. Apply in every bundler that builds runnable
// functions; a missed path leaves the env read in place and fails loudly on the
// Platform's Web runtime (no `process`), which an e2e catches. rolldown exposes
// no `define`, so this is a transform-level replace rather than a define.
//
// The fold above only proves the branch dead after transform+parse; rolldown
// still resolves every top-level import a module contains before it can shake
// the dead branch out of the output. `createWorkflowJob`'s test-only invoker
// wrapper (test-env-key.ts, reachable from every bundler through the public
// `createWorkflowJob` export) needs `node:async_hooks` for correct scoping
// across concurrent local job invocations, but that specifier is never
// available on the Platform runtime and is unreachable there once the gate
// folds — so resolve it as external rather than failing the build over an
// import that never survives to the bundled output.
export const platformBundleDefinePlugin: rolldown.Plugin = {
  name: "tailor-platform-bundle-define",
  transform(code) {
    if (!code.includes("process.env.__TAILOR_PLATFORM_BUNDLE")) return null;
    return { code: code.replace(GATE, "true") };
  },
  resolveId(source) {
    if (source === "node:async_hooks") return { id: source, external: true };
    return null;
  },
};
