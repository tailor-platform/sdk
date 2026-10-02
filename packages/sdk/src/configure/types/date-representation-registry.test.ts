import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { afterAll, describe, expect, test } from "vitest";

const SRC_DIR = join(import.meta.dirname, "..", "..");

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
      paths: {
        "@tailor-platform/sdk": [join(SRC_DIR, "configure", "index.ts")],
        "@tailor-platform/sdk/runtime": [join(SRC_DIR, "runtime", "index.ts")],
      },
    },
  });

  return ts
    .getPreEmitDiagnostics(program, program.getSourceFile(fileName))
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, " "));
}

describe("DateRepresentationRegistry", () => {
  test("a tailor.d.ts-style augmentation of @tailor-platform/sdk types t.date(), t.datetime(), and t.time() fields that omit as", () => {
    expect(
      diagnosticsFor(`
        import { t } from "@tailor-platform/sdk";
        import type { Temporal } from "@tailor-platform/sdk/runtime";

        declare module "@tailor-platform/sdk" {
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
        type Output = t.output<typeof fields>;

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
