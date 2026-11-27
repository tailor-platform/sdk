// Vite's config loader warns unless this import ends in `.ts`, which tsc rejects (TS5097), so tsconfig.json leaves this file out.
import base from "./vitest.config.ts";

// Mootant runs every test that imports a mutated file; e2e tests need Platform credentials.
export default {
  ...base,
  test: {
    ...base.test,
    projects: (base.test?.projects ?? []).filter(
      (project) =>
        typeof project === "object" &&
        "test" in project &&
        String(project.test?.name).startsWith("unit"),
    ),
  },
};
