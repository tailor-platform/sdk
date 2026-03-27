import { describe, it } from "vitest";
import { runFixtureTest } from "../../__test_fixtures__/fixture-helper";

describe("tailordb-import-path rule", () => {
  it("should rename @tailor-platform/sdk/tailordb to @tailor-platform/sdk/schema", async () => {
    await runFixtureTest("v2/tailordb-import-path", (source) => {
      if (!source.includes("@tailor-platform/sdk/tailordb")) return null;
      return source.replaceAll("@tailor-platform/sdk/tailordb", "@tailor-platform/sdk/schema");
    });
  });
});
