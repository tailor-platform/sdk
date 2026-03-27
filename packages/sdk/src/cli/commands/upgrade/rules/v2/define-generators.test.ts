import { describe, it } from "vitest";
import { runFixtureTest } from "../../__test_fixtures__/fixture-helper";
import { findPattern } from "../../codemod-engine";

describe("define-generators rule", () => {
  it("should rename defineGenerators to definePlugins", async () => {
    await runFixtureTest("v2/define-generators", (source) => {
      const matches = findPattern(source, "defineGenerators");
      if (matches.length === 0) return null;
      return source.replaceAll("defineGenerators", "definePlugins");
    });
  });
});
