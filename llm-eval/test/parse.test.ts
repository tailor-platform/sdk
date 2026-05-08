import { describe, expect, it } from "vitest";
import { parseCode } from "../src/checks/parse.ts";

describe("parseCode", () => {
  it("collects imports, calls, and guess comments", () => {
    const code = `
import { createWorkflow, scheduleTrigger } from "@tailor-platform/sdk";

// GUESS: assumed every-day cron syntax
const wf = createWorkflow({
  name: "daily",
  schedule: scheduleTrigger({ cron: "0 9 * * *" }),
});

await wf.trigger({ note: "hi" });
export default wf;
`;
    const parsed = parseCode(code);
    expect(parsed.imports).toHaveLength(1);
    expect(parsed.imports[0].path).toBe("@tailor-platform/sdk");
    expect(parsed.imports[0].named).toEqual(["createWorkflow", "scheduleTrigger"]);

    const callees = parsed.calls.map((c) => c.callee);
    expect(callees).toContain("createWorkflow");
    expect(callees).toContain("scheduleTrigger");
    expect(callees).toContain("wf.trigger");

    const trigger = parsed.calls.find((c) => c.callee === "wf.trigger");
    expect(trigger?.awaited).toBe(true);

    expect(parsed.guessComments).toHaveLength(1);
    expect(parsed.guessComments[0].text).toMatch(/cron/);
  });
});
