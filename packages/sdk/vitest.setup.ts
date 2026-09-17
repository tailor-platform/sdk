// SDK unit tests use the Node environment; consumer tests receive Temporal
// from tailor-runtime instead.
if (!("Temporal" in globalThis)) {
  Object.defineProperty(globalThis, "Temporal", {
    value: (await import("temporal-polyfill/full/implementation")).Temporal,
    configurable: true,
    writable: true,
  });
}

// Tests must not observe TAILOR_* variables exported by the developer's
// shell (profile, machine user, token, ...); tests that need one set it
// explicitly. The e2e projects do not load this file: they take workspace
// credentials from the environment by design.
export function stripTailorEnv(env: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(env)) {
    if (key.startsWith("TAILOR_")) {
      delete env[key];
    }
  }
}

stripTailorEnv(process.env);
