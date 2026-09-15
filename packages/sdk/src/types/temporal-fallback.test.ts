import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { afterAll, describe, expect, test } from "vitest";

const SDK_ROOT = join(import.meta.dirname, "..", "..");

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// `skipLibCheck: false` and unfiltered diagnostics are deliberate: this test
// pins the SDK's own advertised opt-in fallback, so it must also fail if a
// direct `Temporal.PlainDate` reference is reintroduced into `helpers.ts` or
// `field.types.ts` themselves, not just into files that merely import them.
function diagnosticsFor(source: string, lib: string[]): string[] {
  const dir = mkdtempSync(join(tmpdir(), "tailor-temporal-fallback-"));
  tempDirs.push(dir);
  const fileName = join(dir, "case.ts");
  writeFileSync(fileName, source);

  const program = ts.createProgram({
    rootNames: [fileName],
    options: {
      strict: true,
      skipLibCheck: false,
      noEmit: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      lib,
    },
  });

  return ts
    .getPreEmitDiagnostics(program)
    .map(
      (diagnostic) =>
        `${diagnostic.file?.fileName ?? "<unknown>"}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`,
    );
}

const NO_TEMPORAL_LIB = ["lib.es2022.d.ts"];
const WITH_TEMPORAL_LIB = ["lib.es2022.d.ts", "lib.esnext.temporal.d.ts"];

describe("Temporal type opt-in fallback", () => {
  test("public date/serialize types compile cleanly without ESNext.Temporal, as long as a temporal field isn't instantiated", () => {
    const messages = diagnosticsFor(
      `
      import type { DeepWritable, SerializeDates } from "${join(SDK_ROOT, "src", "types", "helpers")}";
      import type { DateFieldValue } from "${join(SDK_ROOT, "src", "configure", "types", "field.types")}";

      type Row = { day: DateFieldValue<"date">; label: DateFieldValue<undefined> };
      type _Writable = DeepWritable<Row>;
      type _Serialized = SerializeDates<Row>;
      `,
      NO_TEMPORAL_LIB,
    );
    expect(messages).toEqual([]);
  });

  test("DateFieldValue's temporal branch names the missing lib requirement without ESNext.Temporal", () => {
    const messages = diagnosticsFor(
      `
      import type { DateFieldValue } from "${join(SDK_ROOT, "src", "configure", "types", "field.types")}";

      declare const value: DateFieldValue<"temporal">;
      value.add({ days: 1 });
      `,
      NO_TEMPORAL_LIB,
    );
    expect(messages.join("\n")).toContain(
      'requires \\"ESNext.Temporal\\" in compilerOptions.lib (TypeScript 6.0+)',
    );
  });

  test("DateFieldValue's temporal branch resolves to the real Temporal.PlainDate when the lib provides it", () => {
    const messages = diagnosticsFor(
      `
      import type { DateFieldValue } from "${join(SDK_ROOT, "src", "configure", "types", "field.types")}";

      declare const value: DateFieldValue<"temporal">;
      const next: Temporal.PlainDate = value.add({ days: 1 });
      const roundTrip: DateFieldValue<"temporal"> = Temporal.PlainDate.from("2026-09-15");
      `,
      WITH_TEMPORAL_LIB,
    );
    expect(messages).toEqual([]);
  });
});
