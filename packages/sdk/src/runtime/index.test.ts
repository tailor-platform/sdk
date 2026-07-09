/**
 * Tests for the aggregate `@tailor-platform/sdk/runtime` entry point.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, expectTypeOf, test } from "vitest";
import {
  file,
  type iconv as runtimeIconv,
  type idp as runtimeIdp,
  type iconv,
  type idp,
} from "#/runtime/index";
import { cleanupMocks, injectMocks, mockFile } from "#/vitest/mock";
import type { TailorDBFileErrorCode } from "#/runtime/file";
import type { IconvInstance } from "#/runtime/iconv";
import type { ClientConfig, IdpClientInstance } from "#/runtime/idp";

const fileArgs = ["ns", "Doc", "blob", "rec-1"] as const;
const packageRoot = path.resolve(import.meta.dirname, "../..");

function declarationEmitDiagnostics(source: string): string {
  const tmpDir = mkdtempSync(path.join(packageRoot, ".tmp-runtime-declaration-"));
  try {
    const tsconfigPath = path.join(tmpDir, "tsconfig.json");
    writeFileSync(path.join(tmpDir, "index.ts"), source, "utf8");
    writeFileSync(
      tsconfigPath,
      JSON.stringify({
        extends: "../tsconfig.json",
        compilerOptions: {
          declaration: true,
          emitDeclarationOnly: true,
          noEmit: false,
          incremental: false,
          outDir: "dist",
        },
        include: ["index.ts"],
      }),
      "utf8",
    );

    const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
    if (configFile.error) {
      return ts.formatDiagnosticsWithColorAndContext([configFile.error], diagnosticHost(tmpDir));
    }

    const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, tmpDir);
    const program = ts.createProgram(config.fileNames, config.options);
    const emit = program.emit();
    const diagnostics = [...ts.getPreEmitDiagnostics(program), ...emit.diagnostics];
    return ts.formatDiagnosticsWithColorAndContext(diagnostics, diagnosticHost(tmpDir));
  } finally {
    rmSync(tmpDir, { force: true, recursive: true });
  }
}

function diagnosticHost(cwd: string): ts.FormatDiagnosticsHost {
  return {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => cwd,
    getNewLine: () => "\n",
  };
}

describe("@tailor-platform/sdk/runtime aggregate exports", () => {
  beforeEach(() => {
    injectMocks(globalThis);
  });

  afterEach(() => {
    cleanupMocks(globalThis);
  });

  test("preserves namespace type access for aggregate imports", () => {
    expectTypeOf<iconv.IconvInstance>().toEqualTypeOf<IconvInstance>();
    expectTypeOf<idp.ClientConfig>().toEqualTypeOf<ClientConfig>();
    expectTypeOf<file.TailorDBFileErrorCode>().toEqualTypeOf<TailorDBFileErrorCode>();
  });

  test("exposes named instance types for namespace constructors", () => {
    expectTypeOf<InstanceType<typeof runtimeIconv.Iconv>>().toEqualTypeOf<IconvInstance>();
    expectTypeOf<InstanceType<typeof runtimeIdp.Client>>().toEqualTypeOf<IdpClientInstance>();
  });

  test("emits declarations for exported namespace constructor instances", () => {
    const diagnostics = declarationEmitDiagnostics(`
      import { idp } from "#/runtime/idp";
      import iconv from "#/runtime/iconv";

      export const makeClient = () => new idp.Client({ namespace: "default" });
      export const makeConverter = () => new iconv.Iconv("UTF-8", "Shift_JIS");
    `);

    expect(diagnostics).toBe("");
  });

  test("keeps the file.deleteFile alias on the aggregate file namespace", async () => {
    using fileM = mockFile();

    await file.deleteFile(...fileArgs);

    expect(file.deleteFile).toBe(file.delete);
    expect(fileM.calls).toEqual([
      {
        method: "delete",
        namespace: "ns",
        typeName: "Doc",
        fieldName: "blob",
        recordId: "rec-1",
      },
    ]);
  });
});
