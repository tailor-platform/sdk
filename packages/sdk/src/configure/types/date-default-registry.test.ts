import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptTarget } from "typescript/ast";
import { ModuleKind, ModuleResolutionKind } from "typescript/sync";
import { afterAll, describe, expect, test } from "vitest";
import { createTypeChecker, flattenDiagnosticText } from "#/utils/test-helpers/type-check";

const SDK_SRC = join(import.meta.dirname, "..", "..");

const tempDirs: string[] = [];
const checker = createTypeChecker();

afterAll(() => {
  checker.close();
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

type App = { name: string; defaultDateRepresentation?: "temporal" | "date" };

function registryFile(app: App): string {
  return `declare module "@tailor-platform/sdk" {\n  interface DateRepresentationRegistry {\n    ${JSON.stringify(app.name)}: ${JSON.stringify(app.defaultDateRepresentation ?? "unset")};\n  }\n}\n\nexport {};\n`;
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
  for (const [index, app] of apps.entries()) {
    const appDir = join(dir, "apps", `${index}-${app.name}`);
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

  return checker
    .diagnostics(rootNames, {
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      target: ScriptTarget.ES2022,
      module: ModuleKind.ESNext,
      moduleResolution: ModuleResolutionKind.Bundler,
      paths: {
        "@tailor-platform/sdk": [join(SDK_SRC, "configure", "index.ts")],
        "@tailor-platform/sdk/runtime": [join(SDK_SRC, "runtime", "index.ts")],
      },
    })
    .filter((diagnostic) => diagnostic.fileName?.startsWith(dir))
    .map(
      (diagnostic) =>
        `${diagnostic.fileName?.slice(dir.length + 1)}: TS${diagnostic.code} ${flattenDiagnosticText(diagnostic, " ")}`,
    );
}

const temporalProbe = `
import { t, type output } from "@tailor-platform/sdk";
import type { Temporal } from "@tailor-platform/sdk/runtime";
const field = t.date();
declare const day: output<typeof field>;
export const asTemporal: Temporal.PlainDate = day;
`;

const dateProbe = `
import { t, type output } from "@tailor-platform/sdk";
const field = t.date();
declare const day: output<typeof field>;
export const asDate: Date = day;
`;

const explicitAsProbe = `
import { t } from "@tailor-platform/sdk";
export const day = t.date({ as: "date" });
export const at = t.datetime({ as: "temporal" });
export const time = t.time({ as: "string" });
export const optionalDay = t.date({ as: "temporal", optional: true });
`;

const stringProbe = `
import { t, type output } from "@tailor-platform/sdk";
const field = t.date();
declare const day: output<typeof field>;
export const asString: string = day;
`;

// Each case compiles the SDK entry through the TypeScript API, which takes seconds under load.
describe("DateRepresentationRegistry through the public package entry", { timeout: 60_000 }, () => {
  test("one app set to temporal types t.date() as Temporal.PlainDate", () => {
    const diagnostics = diagnosticsFor(
      [{ name: "shop", defaultDateRepresentation: "temporal" }],
      temporalProbe,
    );
    expect(diagnostics).toEqual([]);
  });

  test("one app set to date types t.date() as Date", () => {
    expect(
      diagnosticsFor([{ name: "shop", defaultDateRepresentation: "date" }], dateProbe),
    ).toEqual([]);
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

  test("an explicit `as` still compiles when the included apps disagree", () => {
    const diagnostics = diagnosticsFor(
      [{ name: "admin", defaultDateRepresentation: "temporal" }, { name: "user" }],
      explicitAsProbe,
    );
    expect(diagnostics.filter((d) => d.startsWith("probe.ts:"))).toEqual([]);
  });
});
