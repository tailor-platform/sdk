import { describe, it } from "vitest";
import { runFixtureTest } from "../../__test_fixtures__/fixture-helper";
import { applyPatternReplace } from "../../codemod-engine";

describe("auth-invoker-rename rule", () => {
  it("should rename auth.invoker() to auth.machineUser() and authInvoker to invoker", async () => {
    await runFixtureTest("v2/auth-invoker-rename", (source) => {
      let result = source;
      let totalChanged = 0;

      // Pass 1: Rename *.invoker() -> *.machineUser()
      const pass1 = applyPatternReplace(result, "$OBJ.invoker($$$ARGS)", (node) => {
        const obj = node.getMatch("OBJ")!.text();
        const args = node
          .getMultipleMatches("ARGS")
          .filter((n) => n.kind() !== ",")
          .map((n) => n.text());
        return `${obj}.machineUser(${args.join(", ")})`;
      });
      result = pass1.output;
      totalChanged += pass1.count;

      // Pass 2: Rename authInvoker -> invoker
      if (result.includes("authInvoker")) {
        result = result.replaceAll("authInvoker", "invoker");
        totalChanged++;
      }

      return totalChanged > 0 ? result : null;
    });
  });
});
