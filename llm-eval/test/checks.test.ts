import { describe, expect, it } from "vitest";
import { extractCodeBlock } from "../src/checks/extract-code.ts";
import { extractSignals } from "../src/checks/extract.ts";
import { computeVibeDistance } from "../src/checks/ast-distance.ts";
import { loadInventory } from "../src/variants/inventory.ts";
import { resolveVariantPath } from "../src/variants/resolve.ts";

describe("extractCodeBlock", () => {
  it("extracts ts code block", () => {
    const r = `Sure, here is the code:\n\n\`\`\`ts\nconst x = 1;\n\`\`\`\n`;
    const { code, preambleChars } = extractCodeBlock(r);
    expect(code).toBe("const x = 1;");
    expect(preambleChars).toBeGreaterThan(0);
  });

  it("falls back to whole text when no fence", () => {
    const { code } = extractCodeBlock("const x = 1;");
    expect(code).toBe("const x = 1;");
  });
});

describe("checks (against current SDK)", () => {
  const dist = resolveVariantPath("current");

  it("flags hallucinated method on real SDK identifier", async () => {
    const inv = await loadInventory(dist);
    const raw = `\`\`\`ts
import { db } from "@tailor-platform/sdk";
const t = db.unicornType("User");
\`\`\``;
    const { signals } = await extractSignals({
      rawResponse: raw,
      cellId: "test-halluc",
      variantDist: dist,
      inventory: inv,
      checks: ["imports", "halluc", "patterns"],
    });
    const halluc = signals.find((s) => s.type === "hallucinated_method");
    expect(halluc).toBeDefined();
    if (halluc?.type === "hallucinated_method") {
      expect(halluc.receiver).toBe("db");
      expect(halluc.method).toBe("unicornType");
    }
  });

  it("flags hallucinated import from real package", async () => {
    const inv = await loadInventory(dist);
    const raw = `\`\`\`ts
import { defineWorkflow } from "@tailor-platform/sdk";
\`\`\``;
    const { signals } = await extractSignals({
      rawResponse: raw,
      cellId: "test-halluc-import",
      variantDist: dist,
      inventory: inv,
      checks: ["imports", "halluc"],
    });
    const hit = signals.find((s) => s.type === "hallucinated_import");
    expect(hit).toBeDefined();
    if (hit?.type === "hallucinated_import") {
      expect(hit.symbol).toBe("defineWorkflow");
    }
  });

  it("flags wrong import sub-path", async () => {
    const inv = await loadInventory(dist);
    const raw = `\`\`\`ts
import { x } from "@tailor-platform/sdk/server";
\`\`\``;
    const { signals } = await extractSignals({
      rawResponse: raw,
      cellId: "test-wrong-path",
      variantDist: dist,
      inventory: inv,
      checks: ["imports"],
    });
    expect(signals.some((s) => s.type === "wrong_import_path")).toBe(true);
  });

  it("flags forgotten await on .trigger()", async () => {
    const inv = await loadInventory(dist);
    const raw = `\`\`\`ts
import { defineWaitPoints } from "@tailor-platform/sdk";
const wps = defineWaitPoints((d) => ({ x: d() }));
wps.x.trigger({});
\`\`\``;
    const { signals } = await extractSignals({
      rawResponse: raw,
      cellId: "test-await",
      variantDist: dist,
      inventory: inv,
      checks: ["imports", "halluc", "patterns"],
    });
    expect(signals.some((s) => s.type === "forgotten_await")).toBe(true);
  });

  it("does not flag clean code", async () => {
    const inv = await loadInventory(dist);
    const raw = `\`\`\`ts
import { db, t } from "@tailor-platform/sdk";
const User = db.type("User", { name: t.string() });
\`\`\``;
    const { signals } = await extractSignals({
      rawResponse: raw,
      cellId: "test-clean",
      variantDist: dist,
      inventory: inv,
      checks: ["imports", "halluc", "patterns"],
    });
    expect(signals).toEqual([]);
  });
});

describe("computeVibeDistance", () => {
  it("0 when all imports match real SDK", async () => {
    const inv = await loadInventory(resolveVariantPath("current"));
    const code = `
import { createWorkflow, scheduleTrigger } from "@tailor-platform/sdk";
const wf = createWorkflow({});
`;
    const v = computeVibeDistance(code, inv);
    expect(v.distance).toBeLessThan(0.5);
    expect(v.details.matched).toEqual(
      expect.arrayContaining(["createWorkflow", "scheduleTrigger"]),
    );
  });

  it("1 when nothing matches", async () => {
    const inv = await loadInventory(resolveVariantPath("current"));
    const code = `
import { TailorClient } from "@tailor-platform/sdk";
const c = new TailorClient();
c.workflows.deploy({});
`;
    const v = computeVibeDistance(code, inv);
    expect(v.distance).toBeGreaterThan(0.7);
    expect(v.details.invented).toContain("TailorClient");
  });
});
