import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptTarget } from "typescript/ast";
import { ModuleKind, ModuleResolutionKind } from "typescript/sync";
import { afterAll, describe, expect, test } from "vitest";
import { createTypeChecker, flattenDiagnosticText } from "#/utils/test-helpers/type-check";

const SDK_ROOT = join(import.meta.dirname, "..", "..");

const tempDirs: string[] = [];
const checker = createTypeChecker();

afterAll(() => {
  checker.close();
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function diagnosticsFor(source: string, lib: string[]): string[] {
  const dir = mkdtempSync(join(tmpdir(), "tailor-temporal-types-"));
  tempDirs.push(dir);
  const fileName = join(dir, "case.ts");
  writeFileSync(fileName, source);

  return checker
    .diagnostics([fileName], {
      strict: true,
      skipLibCheck: false,
      noEmit: true,
      target: ScriptTarget.ES2022,
      module: ModuleKind.ESNext,
      moduleResolution: ModuleResolutionKind.Bundler,
      lib,
    })
    .map(
      (diagnostic) =>
        `${diagnostic.fileName ?? "<unknown>"}: ${flattenDiagnosticText(diagnostic, " ")}`,
    );
}

const NO_TEMPORAL_LIB = ["lib.es2022.d.ts"];
const WITH_TEMPORAL_LIB = ["lib.es2022.d.ts", "lib.esnext.temporal.d.ts"];

describe("SDK-owned Temporal types", () => {
  test.each([NO_TEMPORAL_LIB, WITH_TEMPORAL_LIB])(
    "Temporal fields and runtime compile with libs %j",
    (...lib) => {
      const messages = diagnosticsFor(
        `
      import { Temporal } from "${join(SDK_ROOT, "src", "runtime", "temporal")}";
      import type { DeepWritable, DeepReadonly, SerializeDates } from "${join(SDK_ROOT, "src", "types", "helpers")}";
      import type { DateFieldValue, DateTimeFieldValue, TimeFieldValue } from "${join(SDK_ROOT, "src", "configure", "types", "field.types")}";

      const day: DateFieldValue<"temporal"> = Temporal.PlainDate.from("2026-09-15");
      const at: DateTimeFieldValue<"temporal"> = Temporal.Instant.from("2026-09-15T00:00:00Z");
      const time: TimeFieldValue<"temporal"> = Temporal.PlainTime.from("12:30");
      const nextDay: Temporal.PlainDate = day.add({ days: 1 });
      const nextAt: Temporal.Instant = at.add({ hours: 1 });
      const nextTime: Temporal.PlainTime = time.add({ minutes: 1 });
      ${
        lib.includes("lib.esnext.temporal.d.ts")
          ? `
      const nativeDay: InstanceType<typeof globalThis.Temporal.PlainDate> = day;
      const nativeAt: InstanceType<typeof globalThis.Temporal.Instant> = at;
      const nativeTime: InstanceType<typeof globalThis.Temporal.PlainTime> = time;
      const sdkDay: typeof day = globalThis.Temporal.PlainDate.from("2026-09-15");
      const sdkAt: typeof at = globalThis.Temporal.Instant.from("2026-09-15T00:00:00Z");
      const sdkTime: typeof time = globalThis.Temporal.PlainTime.from("12:30");
      `
          : ""
      }

      type Row = { day: typeof day; at: typeof at; time: typeof time; legacy: DateFieldValue<undefined>; date: DateFieldValue<"date"> };
      declare const readonly: DeepReadonly<Row>;
      const writable: DeepWritable<Row> = readonly;
      const serialized: SerializeDates<Row> = { day: "2026-09-15", at: "2026-09-15T00:00:00Z", time: "12:30", legacy: "2026-09-15", date: "2026-09-15" };
      `,
        lib,
      );
      expect(messages).toEqual([]);
    },
  );

  test("does not add Temporal to the consumer's globals", () => {
    expect(
      diagnosticsFor(
        `
      import { Temporal as SDKTemporal } from "${join(SDK_ROOT, "src", "runtime", "temporal")}";
      SDKTemporal.PlainDate.from("2026-09-15");
      // @ts-expect-error The SDK does not install global types.
      Temporal.PlainDate.from("2026-09-15");
    `,
        NO_TEMPORAL_LIB,
      ),
    ).toEqual([]);
  });
});
