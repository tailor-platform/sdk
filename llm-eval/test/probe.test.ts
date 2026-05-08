import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadProbe, loadProbesFromDir } from "../src/probe/load.ts";

const here = resolve(fileURLToPath(import.meta.url), "..");
const probesDir = resolve(here, "..", "probes");

describe("probe loader", () => {
  it("loads cold-read.tailordb.basic-type", async () => {
    const p = await loadProbe(resolve(probesDir, "cold-read/tailordb-basic-type.yaml"));
    expect(p.id).toBe("cold-read.tailordb.basic-type");
    expect(p.category).toBe("cold-read");
    expect(p.checks).toContain("imports");
    expect(p.expectedSymbols?.current).toContain("db");
  });

  it("loads all probes in the probes/ tree", async () => {
    const all = await loadProbesFromDir(probesDir);
    const ids = all.map((p) => p.id);
    expect(ids).toContain("cold-read.tailordb.basic-type");
    expect(ids).toContain("cold-read.workflow.basic");
  });
});
