import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { build } from "rolldown";
import { describe, expect, test } from "vitest";
import { createVirtualEntry } from "./virtual-entry";

describe("createVirtualEntry", () => {
  test("resolves the root entry input", async () => {
    const entry = createVirtualEntry("resolver:test", "export const value = 1;");
    const resolveId = entry.plugin.resolveId as unknown as (
      source: string,
      importer?: string,
    ) => unknown;

    expect(await resolveId(entry.input)).toBe(`\0${entry.input}`);
  });

  test("does not intercept the same specifier imported by user code", async () => {
    const entry = createVirtualEntry("resolver:test", "export const value = 1;");
    const resolveId = entry.plugin.resolveId as unknown as (
      source: string,
      importer?: string,
    ) => unknown;

    expect(await resolveId(entry.input, "/project/resolver.ts")).toBeNull();
  });

  test("parses generated JavaScript independently of the logical name suffix", async () => {
    const entry = createVirtualEntry("resolver:report.json", "export const value = 1;");

    const result = await build({
      input: entry.input,
      plugins: [entry.plugin],
      write: false,
      output: { format: "esm" },
    });

    expect(result.output[0].code).toContain("value = 1");
  });

  test("resolves generated imports relative to the source file", async () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "virtual-entry-resolve-")));
    try {
      const dependencyDir = path.join(dir, "node_modules", "fixture-dependency");
      fs.mkdirSync(dependencyDir, { recursive: true });
      fs.writeFileSync(
        path.join(dependencyDir, "package.json"),
        JSON.stringify({ name: "fixture-dependency", type: "module", exports: "./index.js" }),
      );
      fs.writeFileSync(path.join(dependencyDir, "index.js"), 'export const marker = "inlined";\n');
      const sourceFile = path.join(dir, "source.ts");
      fs.writeFileSync(sourceFile, "export {};\n");
      const entry = createVirtualEntry(
        "resolver:dependency",
        'import { marker } from "fixture-dependency";\nexport { marker };\n',
        "js",
        sourceFile,
      );

      const result = await build({
        input: entry.input,
        plugins: [entry.plugin],
        write: false,
        output: { format: "esm" },
      });

      expect(result.output[0].code).toContain('"inlined"');
      expect(result.output[0].code).not.toContain('from "fixture-dependency"');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
