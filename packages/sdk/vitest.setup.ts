// SDK unit tests use the Node environment; consumer tests receive Temporal
// from tailor-runtime instead.
if (!("Temporal" in globalThis)) {
  Object.defineProperty(globalThis, "Temporal", {
    value: (await import("temporal-polyfill/full/implementation")).Temporal,
    configurable: true,
    writable: true,
  });
}

// Tests must not observe variables exported by the developer's shell that
// change CLI behavior: TAILOR_* (profile, machine user, token, ...),
// FORCE_COLOR (styles output to non-TTY streams), and EDITOR/VISUAL (select
// the editor a command spawns, which would block the run). Tests that need
// one set it explicitly. The e2e projects do not load this file: they take
// workspace credentials from the environment by design.
export const STRIPPED_ENV_KEYS: readonly string[] = ["FORCE_COLOR", "EDITOR", "VISUAL"];

export function stripDeveloperEnv(env: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(env)) {
    if (key.startsWith("TAILOR_")) {
      delete env[key];
    }
  }
  for (const key of STRIPPED_ENV_KEYS) {
    delete env[key];
  }
}

stripDeveloperEnv(process.env);
