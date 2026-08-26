import { describe, expect, test } from "vitest";
import vitestConfig from "../../../vitest.config";
import { stripTailorEnv } from "../../../vitest.setup";

describe("test environment isolation", () => {
  // Developer shells commonly export TAILOR_* variables (profile, machine
  // user, token, ...) that change CLI behavior under test. Tests must
  // start from a clean environment and set what they need explicitly.
  test("stripTailorEnv removes every TAILOR_* variable and nothing else", () => {
    const env: NodeJS.ProcessEnv = {
      TAILOR_PLATFORM_PROFILE: "dev",
      TAILOR_PLATFORM_MACHINE_USER_NAME: "developer",
      TAILOR_TOKEN: "tpp_secret",
      PATH: "/usr/bin",
      TAILORING: "not a TAILOR_ prefix",
    };

    stripTailorEnv(env);

    expect(env).toEqual({ PATH: "/usr/bin", TAILORING: "not a TAILOR_ prefix" });
  });

  // Guards the wiring on machines without TAILOR_* variables (including CI),
  // where the runtime assertion below cannot detect a removed registration.
  test("every project except e2e registers the env isolation setup file", () => {
    const projects = vitestConfig.test?.projects ?? [];
    const projectTests = projects.flatMap((project) =>
      typeof project === "object" && "test" in project && project.test ? [project.test] : [],
    );

    expect(projectTests.length).toBeGreaterThan(0);
    for (const projectTest of projectTests) {
      if (projectTest.name === "e2e") continue;
      expect(projectTest.setupFiles, `project "${String(projectTest.name)}"`).toContain(
        "./vitest.setup.ts",
      );
    }
  });

  test("does not inherit TAILOR_* variables from the developer shell", () => {
    const inherited = Object.keys(process.env).filter((key) => key.startsWith("TAILOR_"));
    expect(inherited).toEqual([]);
  });
});
