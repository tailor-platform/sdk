import { describe, expect, test } from "vitest";
import vitestConfig from "../../../vitest.config";
import { STRIPPED_ENV_KEYS, stripDeveloperEnv } from "../../../vitest.setup";

describe("test environment isolation", () => {
  test("stripDeveloperEnv removes TAILOR_*, FORCE_COLOR, EDITOR, and VISUAL and nothing else", () => {
    const env: NodeJS.ProcessEnv = {
      TAILOR_PLATFORM_PROFILE: "dev",
      TAILOR_PLATFORM_MACHINE_USER_NAME: "developer",
      TAILOR_TOKEN: "tpp_secret",
      FORCE_COLOR: "3",
      EDITOR: "code --wait",
      VISUAL: "code --wait",
      PATH: "/usr/bin",
      TAILORING: "not a TAILOR_ prefix",
      NO_COLOR: "1",
      TERM: "xterm-256color",
    };

    stripDeveloperEnv(env);

    expect(env).toEqual({
      PATH: "/usr/bin",
      TAILORING: "not a TAILOR_ prefix",
      NO_COLOR: "1",
      TERM: "xterm-256color",
    });
  });

  // Guards the wiring on machines that export none of the stripped variables
  // (including CI), where the runtime assertion below cannot detect a
  // removed registration.
  test("every non-e2e project registers the env isolation setup file", () => {
    const projects = vitestConfig.test?.projects ?? [];
    const projectTests = projects.flatMap((project) =>
      typeof project === "object" && "test" in project && project.test ? [project.test] : [],
    );

    expect(projectTests.length).toBeGreaterThan(0);
    for (const projectTest of projectTests) {
      if (String(projectTest.name).startsWith("e2e")) continue;
      expect(projectTest.setupFiles, `project "${String(projectTest.name)}"`).toContain(
        "./vitest.setup.ts",
      );
    }
  });

  test("does not inherit TAILOR_*, FORCE_COLOR, EDITOR, or VISUAL from the developer shell", () => {
    const inherited = Object.keys(process.env).filter(
      (key) => key.startsWith("TAILOR_") || STRIPPED_ENV_KEYS.includes(key),
    );
    expect(inherited).toEqual([]);
  });
});
