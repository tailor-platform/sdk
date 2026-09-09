/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, test, vi } from "vitest";
import { createEnvironmentPlugin } from "./plugin";
import type * as NodeModule from "node:module";

// The plugin reads the resolved Vitest peer's major once and caches it, so the
// Vitest 4 branch needs its own module registry — hence a separate file rather
// than a case inside plugin.test.ts, which exercises the installed Vitest 5.
vi.mock("node:module", async () => {
  const actual = await vi.importActual<typeof NodeModule>("node:module");
  return {
    ...actual,
    createRequire: (url: string | URL) => {
      const require = actual.createRequire(url);
      return Object.assign(
        (id: string) => (id === "vitest/package.json" ? { version: "4.1.11" } : require(id)),
        require,
      );
    },
  };
});

describe("createEnvironmentPlugin under Vitest 4", () => {
  const applyConfig = (plugin: ReturnType<typeof createEnvironmentPlugin>, userConfig: any) =>
    (plugin.config as any).call({}, userConfig);

  test("leaves a project that omits `extends` on its own environment", () => {
    // Vitest 4 only inherits the declaring config's settings into a project
    // that opts in with `extends: true`. Rewriting a project that merely
    // omits `extends` would move an existing Node project onto tailor-runtime
    // and break its use of `Buffer` and other Node globals.
    const plugin = createEnvironmentPlugin();
    const userConfig: any = {
      test: {
        environment: "tailor-runtime",
        projects: [{ test: { name: "omits-extends" } }],
      },
    };
    applyConfig(plugin, userConfig);

    expect(userConfig.test.projects[0].test.environment).toBeUndefined();
    expect(userConfig.test.projects[0].test.setupFiles).toBeUndefined();
  });

  test("still rewrites a project that opts in with `extends: true`", () => {
    const plugin = createEnvironmentPlugin();
    const userConfig: any = {
      test: {
        environment: "tailor-runtime",
        projects: [{ test: { name: "opts-in" }, extends: true }],
      },
    };
    applyConfig(plugin, userConfig);

    expect(userConfig.test.projects[0].test.environment).toMatch(/environment\.mjs$/);
    expect(userConfig.test.projects[0].test.setupFiles).toEqual([
      expect.stringMatching(/setup\.mjs$/),
    ]);
  });

  test("still rewrites a project that names tailor-runtime explicitly", () => {
    const plugin = createEnvironmentPlugin();
    const userConfig: any = {
      test: { projects: [{ test: { name: "explicit", environment: "tailor-runtime" } }] },
    };
    applyConfig(plugin, userConfig);

    expect(userConfig.test.projects[0].test.environment).toMatch(/environment\.mjs$/);
  });
});
