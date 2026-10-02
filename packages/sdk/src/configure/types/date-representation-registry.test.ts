import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { afterAll, describe, expect, test } from "vitest";

const TYPES_DIR = import.meta.dirname;

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function diagnosticsFor(source: string): string[] {
  const dir = mkdtempSync(join(tmpdir(), "tailor-date-representation-"));
  tempDirs.push(dir);
  const fileName = join(dir, "case.ts");
  writeFileSync(fileName, source);

  const program = ts.createProgram({
    rootNames: [fileName],
    options: {
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      lib: ["lib.es2022.d.ts"],
    },
  });

  return ts
    .getPreEmitDiagnostics(program)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, " "));
}

describe("DateRepresentationRegistry", () => {
  test("an augmented default representation types t.date(), t.datetime(), and t.time() fields that omit as", () => {
    expect(
      diagnosticsFor(`
        import type { Temporal } from "${join(TYPES_DIR, "..", "..", "runtime", "temporal")}";
        import { t } from "${join(TYPES_DIR, "type")}";
        import type { output } from "${join(TYPES_DIR, "..", "..", "types", "helpers")}";

        declare module "${join(TYPES_DIR, "field.types")}" {
          interface DateRepresentationRegistry {
            default: "temporal";
          }
        }

        const fields = t.object({
          day: t.date(),
          at: t.datetime({ optional: true }),
          time: t.time({ array: true }),
          legacy: t.datetime({ as: "string" }),
        });
        type Output = output<typeof fields>;

        const value: Output = {
          day: {} as Temporal.PlainDate,
          at: {} as Temporal.Instant,
          time: [{} as Temporal.PlainTime],
          legacy: "2026-10-02T00:00:00Z",
        };
        // @ts-expect-error day is a Temporal.PlainDate under the default representation.
        const day: Output["day"] = "2026-10-02";
      `),
    ).toEqual([]);
  });
});
