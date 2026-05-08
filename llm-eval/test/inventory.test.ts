import { describe, expect, it } from "vitest";
import { loadInventory } from "../src/variants/inventory.ts";
import { resolveVariantPath } from "../src/variants/resolve.ts";

describe("inventory (current SDK dist)", () => {
  it("collects core SDK exports", async () => {
    const dist = resolveVariantPath("current");
    const inv = await loadInventory(dist);

    expect(inv.symbols.size).toBeGreaterThan(50);
    for (const sym of [
      "createWorkflow",
      "createWorkflowJob",
      "createResolver",
      "createExecutor",
      "defineConfig",
      "defineAuth",
      "defineIdp",
      "defineStaticWebSite",
      "definePlugins",
      "scheduleTrigger",
      "recordCreatedTrigger",
      "db",
      "t",
    ]) {
      expect(inv.symbols.has(sym), `expected SDK to export ${sym}`).toBe(true);
    }
  });

  it("does not contain hallucinated symbols", async () => {
    const dist = resolveVariantPath("current");
    const inv = await loadInventory(dist);

    for (const sym of ["clientWorkflow", "runWorkflow", "defineWorkflow", "tailorClient"]) {
      expect(inv.symbols.has(sym), `unexpected SDK export: ${sym}`).toBe(false);
    }
  });
});
