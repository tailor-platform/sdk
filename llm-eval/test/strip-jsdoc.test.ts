import { describe, expect, it } from "vitest";
import { stripJsdoc } from "../src/variants/strip-jsdoc.ts";

describe("stripJsdoc", () => {
  it("removes JSDoc blocks but keeps types", () => {
    const src = `/**
 * Creates a workflow.
 * @example
 * createWorkflow({ ... })
 */
export declare function createWorkflow(opts: WorkflowConfig): Workflow;
`;
    const out = stripJsdoc(src);
    expect(out).not.toContain("Creates a workflow");
    expect(out).not.toContain("@example");
    expect(out).toContain("createWorkflow(opts: WorkflowConfig): Workflow");
  });

  it("preserves non-JSDoc comments", () => {
    const src = `// regular comment
/** doc */
export type Foo = string;
`;
    const out = stripJsdoc(src);
    expect(out).toContain("// regular comment");
    expect(out).not.toContain("/** doc */");
  });
});
