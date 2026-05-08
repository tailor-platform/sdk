import { describe, expect, it } from "vitest";
import { buildDocsContext } from "../src/conditions/builder.ts";
import { makeCondition } from "../src/conditions/presets.ts";
import { resolveVariantPath } from "../src/variants/resolve.ts";

describe("buildDocsContext (current SDK)", () => {
  const dist = resolveVariantPath("current");

  it("predicted preset → empty context", async () => {
    const ctx = await buildDocsContext(makeCondition("predicted"), dist);
    expect(ctx.text).toBe("");
    expect(ctx.sections).toHaveLength(0);
  });

  it("bare preset → only L1 type signatures (no JSDoc)", async () => {
    const ctx = await buildDocsContext(makeCondition("bare"), dist);
    expect(ctx.sections).toHaveLength(1);
    expect(ctx.sections[0].layer).toBe("L1");
    expect(ctx.text).toContain("createWorkflow");
  });

  it("jsdoc preset → L2", async () => {
    const ctx = await buildDocsContext(makeCondition("jsdoc"), dist);
    expect(ctx.sections).toHaveLength(1);
    expect(ctx.sections[0].layer).toBe("L2");
  });

  it("inPackage adds L3/L4 when files exist", async () => {
    const ctx = await buildDocsContext(makeCondition("inPackage"), dist);
    const layers = ctx.sections.map((s) => s.layer);
    expect(layers).toContain("L2");
    // L3 / L4 are best-effort — packages/sdk has README + skills
    expect(layers).toContain("L3");
  });
});
