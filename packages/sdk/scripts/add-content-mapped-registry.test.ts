import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { addContentMappedRegistry } from "./add-content-mapped-registry";

const ENTRY_TYPES = 'export { db } from "./services/tailordb/schema.mjs";\n';

describe("addContentMappedRegistry", () => {
  let dist: string;
  const entry = () => join(dist, "configure", "index.d.mts");

  beforeEach(() => {
    dist = mkdtempSync(join(tmpdir(), "sdk-dist-"));
    mkdirSync(join(dist, "configure"));
    writeFileSync(entry(), ENTRY_TYPES);
  });

  afterEach(() => {
    rmSync(dist, { recursive: true, force: true });
  });

  test("ships a .tailor file next to the entry types", () => {
    addContentMappedRegistry(dist);

    const registry = readFileSync(join(dist, "configure", "registry.tailor"), "utf8");
    expect(registry).toMatch(/^\/\/ /);
    expect(registry).toContain("tailor.config.ts");
  });

  test("ships db.tailor next to the kysely type plugin's runtime", () => {
    addContentMappedRegistry(dist);

    const db = readFileSync(join(dist, "plugin", "builtin", "kysely-type", "db.tailor"), "utf8");
    expect(db).toMatch(/^\/\/ /);
    expect(db).toContain("kyselyTypePlugin");
  });

  test("makes the entry types import the .tailor file without failing where no content mapper runs", () => {
    addContentMappedRegistry(dist);

    expect(readFileSync(entry(), "utf8")).toBe(
      `// @ts-ignore\nimport "./registry.tailor";\n${ENTRY_TYPES}`,
    );
  });

  test("adds the import only once when run again", () => {
    addContentMappedRegistry(dist);
    addContentMappedRegistry(dist);

    expect(readFileSync(entry(), "utf8").match(/registry\.tailor/g)).toHaveLength(1);
  });
});
