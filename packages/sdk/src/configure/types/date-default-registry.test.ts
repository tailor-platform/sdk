import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { afterAll, describe, expect, test } from "vitest";

const SDK_SRC = join(import.meta.dirname, "..", "..");

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

type App = { name: string; defaultDateRepresentation?: "temporal" };

function registryFile(app: App): string {
  const value = app.defaultDateRepresentation ? `"${app.defaultDateRepresentation}"` : "undefined";
  return `declare module "@tailor-platform/sdk" {\n  interface DateRepresentationRegistry {\n    ${app.name}: ${value};\n  }\n}\n\nexport {};\n`;
}

const passthroughResolver = `
import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "passthrough",
  operation: "query",
  input: { day: t.date() },
  output: t.date(),
  body: async ({ input }) => input.day,
});
`;

function diagnosticsFor(apps: App[], probe: string): string[] {
  const dir = mkdtempSync(join(tmpdir(), "tailor-date-default-registry-"));
  tempDirs.push(dir);
  const rootNames: string[] = [];
  for (const app of apps) {
    const appDir = join(dir, "apps", app.name);
    mkdirSync(appDir, { recursive: true });
    const registry = join(appDir, "tailor.d.ts");
    writeFileSync(registry, registryFile(app));
    rootNames.push(registry);
  }
  const resolverFile = join(dir, "passthrough.ts");
  writeFileSync(resolverFile, passthroughResolver);
  const probeFile = join(dir, "probe.ts");
  writeFileSync(probeFile, probe);
  rootNames.push(resolverFile, probeFile);

  const program = ts.createProgram({
    rootNames,
    options: {
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      paths: {
        "@tailor-platform/sdk": [join(SDK_SRC, "configure", "index.ts")],
        "@tailor-platform/sdk/runtime": [join(SDK_SRC, "runtime", "index.ts")],
      },
    },
  });

  return ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.file && diagnostic.file.fileName.startsWith(dir))
    .map(
      (diagnostic) =>
        `${diagnostic.file?.fileName.slice(dir.length + 1)}: TS${diagnostic.code} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`,
    );
}

const temporalProbe = `
import { t, type output } from "@tailor-platform/sdk";
import type { Temporal } from "@tailor-platform/sdk/runtime";
const field = t.date();
declare const day: output<typeof field>;
export const asTemporal: Temporal.PlainDate = day;
`;

const stringProbe = `
import { t, type output } from "@tailor-platform/sdk";
const field = t.date();
declare const day: output<typeof field>;
export const asString: string = day;
`;

// Each case compiles the SDK entry through ts.createProgram, which takes seconds under load.
describe("DateRepresentationRegistry through the public package entry", { timeout: 60_000 }, () => {
  test("one app set to temporal types t.date() as Temporal.PlainDate", () => {
    const diagnostics = diagnosticsFor(
      [{ name: "shop", defaultDateRepresentation: "temporal" }],
      temporalProbe,
    );
    expect(diagnostics).toEqual([]);
  });

  test("one unset app keeps t.date() as a string", () => {
    expect(diagnosticsFor([{ name: "shop" }], stringProbe)).toEqual([]);
    const mismatch = diagnosticsFor([{ name: "shop" }], temporalProbe);
    expect(mismatch).toHaveLength(1);
    expect(mismatch[0]).toContain("probe.ts: TS2322");
  });

  test("two apps with different settings in one program reject t.date() without `as`", () => {
    const diagnostics = diagnosticsFor(
      [{ name: "admin", defaultDateRepresentation: "temporal" }, { name: "user" }],
      "export {};",
    );
    const resolverErrors = diagnostics.filter((d) => d.startsWith("passthrough.ts: TS2554"));
    expect(resolverErrors).toHaveLength(2);
    expect(resolverErrors[0]).toContain("Expected 2 arguments, but got 0");
  });
});
