import { describe, it } from "vitest";
import { runFixtureTest } from "../../__test_fixtures__/fixture-helper";

describe("publish-events-rename rule", () => {
  it("should rename publishEvents to emitEvents", async () => {
    await runFixtureTest("v2/publish-events-rename", (source) => {
      if (!source.includes("publishEvents")) return null;
      return source.replaceAll("publishEvents", "emitEvents");
    });
  });
});
