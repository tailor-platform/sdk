import { describe, expect, it } from "vitest";
import { runFixtureTest } from "../../__test_fixtures__/fixture-helper";
import { renameExecutorTriggersRule } from "./rename-executor-triggers";

describe("rename-executor-triggers rule", () => {
  it("should rename all trigger functions in imports, calls, and comments", async () => {
    await runFixtureTest("v2/rename-executor-triggers", renameExecutorTriggersRule.transformSource);
  });

  it("should return null for unrelated code", () => {
    const source = `
import { createExecutor } from "@tailor-platform/sdk";

export default createExecutor({
  name: "my-executor",
  trigger: someOtherTrigger({ type: "foo" }),
  operation: { kind: "function", body: () => {} },
});
`;
    expect(renameExecutorTriggersRule.transformSource(source)).toBeNull();
  });

  it("should return null for code with no trigger references", () => {
    const source = `
import { createResolver } from "@tailor-platform/sdk";

export default createResolver({
  name: "my-resolver",
  operation: "query",
  input: {},
  body: () => ({}),
  output: {},
});
`;
    expect(renameExecutorTriggersRule.transformSource(source)).toBeNull();
  });

  it("should handle a single trigger rename", () => {
    const source = `import { scheduleTrigger } from "@tailor-platform/sdk";
const t = scheduleTrigger({ cron: "0 0 * * *" });
`;
    const result = renameExecutorTriggersRule.transformSource(source);
    expect(result).not.toBeNull();
    expect(result).toContain("onSchedule");
    expect(result).not.toContain("scheduleTrigger");
  });

  it("should handle incomingWebhookTrigger with generic type parameter", () => {
    const source = `import { incomingWebhookTrigger } from "@tailor-platform/sdk";
const t = incomingWebhookTrigger<{ body: string }>();
`;
    const result = renameExecutorTriggersRule.transformSource(source);
    expect(result).not.toBeNull();
    expect(result).toContain("onWebhook<{ body: string }>()");
    expect(result).not.toContain("incomingWebhookTrigger");
  });
});
