import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { datasetDumpDirectory, selectDatasets } from "./datasets";
import type { SeedContext } from "@tailor-platform/sdk/cli";

let distPath: string;
let dataDir: string;

function context(overrides: Partial<SeedContext> = {}): SeedContext {
  return {
    config: { path: path.join(distPath, "tailor.config.ts") },
    distPath,
    datasets: {},
    idpUser: null,
    namespaces: [
      {
        namespace: "tailordb",
        types: ["Item", "ItemValuation"],
        dependencies: { Item: [], ItemValuation: ["Item"] },
        selfRefTypes: [],
        requiredFields: { Item: [], ItemValuation: [] },
      },
    ],
    ...overrides,
  } as SeedContext;
}

function dataset(name: string, files: string[] = []): string {
  const dir = path.join(dataDir, name);
  mkdirSync(dir, { recursive: true });
  for (const file of files) {
    writeFileSync(path.join(dir, file), "");
  }
  return dir;
}

beforeEach(() => {
  distPath = mkdtempSync(path.join(tmpdir(), "seed-datasets-"));
  dataDir = path.join(distPath, "data");
  mkdirSync(dataDir);
});

afterEach(() => {
  rmSync(distPath, { recursive: true, force: true });
});

describe("selectDatasets", () => {
  test("selects nothing when no dataset is named", () => {
    expect(selectDatasets(context(), [])).toEqual({ names: [], dirs: [] });
  });

  test("selects dataset directories in the order they are named", () => {
    const cogs = dataset("cogs", ["Item.jsonl"]);
    const local = dataset("local");

    expect(selectDatasets(context(), ["local", "cogs"])).toEqual({
      names: ["local", "cogs"],
      dirs: [local, cogs],
    });
  });

  test("expands a name from the datasets option to the directories it lists", () => {
    const cogs = dataset("cogs");
    const shipments = dataset("shipments");
    const local = dataset("local");

    const selected = selectDatasets(context({ datasets: { preview: ["cogs", "shipments"] } }), [
      "preview",
      "local",
    ]);

    expect(selected).toEqual({
      names: ["cogs", "shipments", "local"],
      dirs: [cogs, shipments, local],
    });
  });

  test("loads a directory named more than once only once", () => {
    const cogs = dataset("cogs");
    const shipments = dataset("shipments");
    symlinkSync(cogs, path.join(dataDir, "cogs-alias"));

    const selected = selectDatasets(context({ datasets: { preview: ["cogs", "shipments"] } }), [
      "preview",
      "cogs",
      "cogs-alias",
    ]);

    expect(selected).toEqual({ names: ["cogs", "shipments"], dirs: [cogs, shipments] });
  });

  test("rejects a name that is neither a dataset directory nor a configured dataset", () => {
    dataset("cogs");

    expect(() =>
      selectDatasets(context({ datasets: { preview: ["cogs"] } }), ["shipments"]),
    ).toThrow(
      `Unknown dataset "shipments". Datasets in seedPlugin options: preview. Dataset directories in ${dataDir}: cogs.`,
    );
  });

  test("matches a dataset directory by its exact name", () => {
    dataset("local");

    expect(() => selectDatasets(context(), ["Local"])).toThrow(/Unknown dataset "Local"/);
  });

  test.each(["../data", ".hidden", "a/b", ""])("rejects the invalid dataset name %j", (name) => {
    expect(() => selectDatasets(context(), [name])).toThrow(/is not a valid dataset name/);
  });

  test("rejects a configured dataset that lists a missing directory", () => {
    dataset("cogs");

    expect(() =>
      selectDatasets(context({ datasets: { preview: ["cogs", "shipments"] } }), ["preview"]),
    ).toThrow(
      `Dataset "preview" in seedPlugin options lists "shipments", but ${path.join(dataDir, "shipments")} is not a directory.`,
    );
  });

  test("rejects a configured dataset that shares its name with a dataset directory", () => {
    dataset("preview");
    dataset("cogs");

    expect(() => selectDatasets(context({ datasets: { preview: ["cogs"] } }), ["preview"])).toThrow(
      /"preview" names both a dataset in seedPlugin options and the directory/,
    );
  });

  test("rejects a configured name shared with a directory whichever dataset is named", () => {
    dataset("dev");
    dataset("local");

    expect(() =>
      selectDatasets(context({ datasets: { dev: ["local"], preview: ["dev"] } }), ["preview"]),
    ).toThrow(/"dev" names both a dataset in seedPlugin options and the directory/);
  });

  test("points at `tailor generate` when the seed data directory is missing", () => {
    rmSync(dataDir, { recursive: true });

    expect(() => selectDatasets(context(), ["cogs"])).toThrow(
      `Seed data directory not found: ${dataDir}. Run \`tailor generate\``,
    );
  });

  test("rejects a dataset directory that is the seed data directory itself", () => {
    symlinkSync(".", path.join(dataDir, "all"));

    expect(() => selectDatasets(context(), ["all"])).toThrow(
      `${path.join(dataDir, "all")} is the seed data directory itself, not a dataset.`,
    );
  });

  test("ignores a dangling symlink in the seed data directory", () => {
    const cogs = dataset("cogs");
    symlinkSync(path.join(distPath, "missing"), path.join(dataDir, "ghost"));

    expect(selectDatasets(context(), ["cogs"])).toEqual({ names: ["cogs"], dirs: [cogs] });
  });

  test("rejects a dataset file that does not match a table", () => {
    dataset("cogs", ["Item.jsonl", "Itme.jsonl", "Item.schema.ts"]);

    expect(() => selectDatasets(context(), ["cogs"])).toThrow(
      `${path.join(dataDir, "cogs", "Itme.jsonl")} does not match a seeded table.`,
    );
  });

  test("accepts the IdP user file in a dataset when the project seeds IdP users", () => {
    const local = dataset("local", ["_User.jsonl"]);

    expect(() => selectDatasets(context(), ["local"])).toThrow(/_User\.jsonl does not match/);
    expect(
      selectDatasets(
        context({
          idpUser: {
            idpNamespace: "idp",
            seedScriptCode: "",
            listScriptCode: "",
            truncateScriptCode: "",
          },
        }),
        ["local"],
      ),
    ).toEqual({ names: ["local"], dirs: [local] });
  });

  test("rejects datasets with an @tailor-platform/sdk that does not support them", () => {
    dataset("cogs");
    const { datasets: _, ...legacy } = context();

    expect(() => selectDatasets(legacy as SeedContext, ["cogs"])).toThrow(
      /does not support seed datasets/,
    );
  });
});

describe("datasetDumpDirectory", () => {
  test("names a directory under the seed data directory, existing or not", () => {
    expect(datasetDumpDirectory(context(), "snapshot")).toBe(path.join(dataDir, "snapshot"));
  });

  test("rejects a name from the datasets option", () => {
    expect(() =>
      datasetDumpDirectory(context({ datasets: { snapshot: ["cogs"] } }), "snapshot"),
    ).toThrow(/names a dataset in seedPlugin options/);
  });

  test("rejects an invalid dataset name", () => {
    expect(() => datasetDumpDirectory(context(), "../out")).toThrow(/is not a valid dataset name/);
  });
});
