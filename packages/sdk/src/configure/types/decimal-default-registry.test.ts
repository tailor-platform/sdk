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

type App = { name: string; defaultDecimalRepresentation?: "decimal" };

function registryFile(app: App): string {
  return `declare module "@tailor-platform/sdk" {\n  interface DecimalRepresentationRegistry {\n    ${JSON.stringify(app.name)}: ${JSON.stringify(app.defaultDecimalRepresentation ?? "unset")};\n  }\n}\n\nexport {};\n`;
}

function diagnosticsFor(apps: App[], probe: string): string[] {
  const dir = mkdtempSync(join(tmpdir(), "tailor-decimal-default-registry-"));
  tempDirs.push(dir);
  const rootNames: string[] = [];
  for (const [index, app] of apps.entries()) {
    const appDir = join(dir, "apps", `${index}-${app.name}`);
    mkdirSync(appDir, { recursive: true });
    const registry = join(appDir, "tailor.d.ts");
    writeFileSync(registry, registryFile(app));
    rootNames.push(registry);
  }
  const probeFile = join(dir, "probe.ts");
  writeFileSync(probeFile, probe);
  rootNames.push(probeFile);

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

const decimalProbe = `
import { t, type output } from "@tailor-platform/sdk";
import type { Decimal } from "@tailor-platform/sdk/runtime";
const field = t.decimal();
declare const price: output<typeof field>;
export const asDecimal: Decimal = price;
`;

const stringProbe = `
import { t, type output } from "@tailor-platform/sdk";
const field = t.decimal();
declare const price: output<typeof field>;
export const asString: string = price;
`;

const optOutProbe = `
import { t, type output } from "@tailor-platform/sdk";
const field = t.decimal({ as: "string" });
declare const price: output<typeof field>;
export const asString: string = price;
`;

const explicitAsProbe = `
import { t } from "@tailor-platform/sdk";
export const price = t.decimal({ as: "decimal" });
export const label = t.decimal({ as: "string", optional: true });
`;

const bareProbe = `
import { t } from "@tailor-platform/sdk";
export const price = t.decimal();
`;

// Each case compiles the SDK entry through ts.createProgram, which takes seconds under load.
describe(
  "DecimalRepresentationRegistry through the public package entry",
  { timeout: 60_000 },
  () => {
    test("one app set to decimal types t.decimal() as Decimal", () => {
      expect(
        diagnosticsFor([{ name: "shop", defaultDecimalRepresentation: "decimal" }], decimalProbe),
      ).toEqual([]);
    });

    test('as: "string" keeps a field a string under the decimal default', () => {
      expect(
        diagnosticsFor([{ name: "shop", defaultDecimalRepresentation: "decimal" }], optOutProbe),
      ).toEqual([]);
    });

    test("one unset app keeps t.decimal() as a string", () => {
      expect(diagnosticsFor([{ name: "shop" }], stringProbe)).toEqual([]);
      expect(diagnosticsFor([{ name: "shop" }], decimalProbe)).not.toEqual([]);
    });

    test("apps that disagree reject t.decimal() without as, and accept an explicit as", () => {
      const apps: App[] = [
        { name: "shop", defaultDecimalRepresentation: "decimal" },
        { name: "billing" },
      ];

      expect(diagnosticsFor(apps, bareProbe).join("\n")).toContain("TS2554");
      expect(diagnosticsFor(apps, explicitAsProbe)).toEqual([]);
    });
  },
);
