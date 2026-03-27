import { describe, it } from "vitest";
import { runFixtureTest } from "../../__test_fixtures__/fixture-helper";
import { applyPatternReplace } from "../../codemod-engine";

describe("db-type-to-model rule", () => {
  it("should rename db.type() to db.model()", async () => {
    await runFixtureTest("v2/db-type-to-model", (source) => {
      const result = applyPatternReplace(source, "$DB.type($$$ARGS)", (node) => {
        const db = node.getMatch("DB")!.text();
        if (db !== "db") return node.text();
        const args = node
          .getMultipleMatches("ARGS")
          .filter((n) => n.kind() !== ",")
          .map((n) => n.text());
        return `${db}.model(${args.join(", ")})`;
      });
      return result.count > 0 ? result.output : null;
    });
  });
});
