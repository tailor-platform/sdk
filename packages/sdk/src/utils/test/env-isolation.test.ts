import { describe, expect, test } from "vitest";

describe("test environment isolation", () => {
  // Developer shells commonly export TAILOR_* variables (profile, machine
  // user, token, ...) that change CLI behavior under test. Unit tests must
  // start from a clean environment and set what they need explicitly.
  test("does not inherit TAILOR_* variables from the developer shell", () => {
    const inherited = Object.keys(process.env).filter((key) => key.startsWith("TAILOR_"));
    expect(inherited).toEqual([]);
  });
});
