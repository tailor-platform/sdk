// Tests must not observe TAILOR_* variables exported by the developer's
// shell (profile, machine user, token, ...); tests that need one set it
// explicitly. The e2e project does not load this file: it takes workspace
// credentials from the environment by design.
export function stripTailorEnv(env: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(env)) {
    if (key.startsWith("TAILOR_")) {
      delete env[key];
    }
  }
}

stripTailorEnv(process.env);
