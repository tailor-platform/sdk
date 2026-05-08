import { describe, expect, it } from "vitest";
import { makeCondition } from "../src/conditions/presets.ts";
import { loadProbe } from "../src/probe/load.ts";
import { MockProvider } from "../src/provider/mock.ts";
import { runMatrix } from "../src/runner/matrix.ts";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = resolve(fileURLToPath(import.meta.url), "..");
const probesDir = resolve(here, "..", "probes");

describe("runMatrix with MockProvider (offline)", () => {
  it("produces tagged cells for a one-probe × all-presets run", async () => {
    const probe = await loadProbe(resolve(probesDir, "cold-read/tailordb-basic-type.yaml"));

    const claudeMock = new MockProvider({
      id: "mock:claude",
      responses: {
        // bare: hallucinated method
        "[L1] Type signatures": `\`\`\`ts
import { db } from "@tailor-platform/sdk";
const User = db.defineType({ name: "string" });
\`\`\``,
      },
      // jsdoc/inPackage/full: clean code that should pass
      fallback: `\`\`\`ts
import { db, t } from "@tailor-platform/sdk";
const User = db.type("User", { name: t.string() });
\`\`\``,
    });
    const codexMock = new MockProvider({
      id: "mock:codex",
      // Always hallucinates the same method → strength=2 DESIGN
      fallback: `\`\`\`ts
import { db } from "@tailor-platform/sdk";
const User = db.defineType({ name: "string" });
\`\`\``,
    });

    const conditions = [makeCondition("bare"), makeCondition("jsdoc"), makeCondition("predicted")];

    const result = await runMatrix({
      probes: [probe],
      providers: [claudeMock, codexMock],
      conditions,
      variants: ["current"],
      concurrency: 4,
    });

    // 1 probe × 2 models × 3 conditions × 1 variant = 6 cells
    expect(result.cells).toHaveLength(6);

    const claudeBare = result.cells.find(
      (c) => c.model === "mock:claude" && c.condition.preset === "bare",
    );
    const claudeJsdoc = result.cells.find(
      (c) => c.model === "mock:claude" && c.condition.preset === "jsdoc",
    );
    expect(claudeBare?.passed).toBe(false);
    expect(claudeJsdoc?.passed).toBe(true);

    // claudeJsdoc should have CUTOFF tag at L2 since bare failed but jsdoc passed
    const tagKinds = claudeJsdoc!.tags.map((t) => t.kind);
    expect(tagKinds).toContain("CUTOFF");

    // Both models hallucinated db.defineType in `bare` → strength≥2 DESIGN tag on bare cells
    const claudeBareTags = claudeBare!.tags.filter((t) => t.kind === "DESIGN");
    expect(claudeBareTags.length).toBeGreaterThanOrEqual(1);
  });
});
