/**
 * Tests for the aggregate `@tailor-platform/sdk/runtime` entry point.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import ts from "typescript";
import { describe, expect, expectTypeOf, test } from "vitest";
import * as aigatewayModule from "#/runtime/aigateway";
import * as authconnectionModule from "#/runtime/authconnection";
import * as contextModule from "#/runtime/context";
import * as fileModule from "#/runtime/file";
import * as iconvModule from "#/runtime/iconv";
import * as idpModule from "#/runtime/idp";
import { file, type iconv as runtimeIconv, type idp as runtimeIdp } from "#/runtime/index";
import * as secretmanagerModule from "#/runtime/secretmanager";
import * as workflowModule from "#/runtime/workflow";
import type { IconvInstance } from "#/runtime/iconv";
import type { IdpClientInstance } from "#/runtime/idp";

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
  test.each([
    ["aigateway", aigatewayModule],
    ["authconnection", authconnectionModule],
    ["context", contextModule],
    ["file", fileModule],
    ["iconv", iconvModule],
    ["idp", idpModule],
    ["secretmanager", secretmanagerModule],
    ["workflow", workflowModule],
  ])("%s subpath has no default export", (_name, runtimeModule) => {
    expect(runtimeModule).not.toHaveProperty("default");
  });

  test("exposes constructor instance types through namespace object values", () => {
    expectTypeOf<InstanceType<typeof runtimeIconv.Iconv>>().toEqualTypeOf<IconvInstance>();
    expectTypeOf<InstanceType<typeof runtimeIdp.Client>>().toEqualTypeOf<IdpClientInstance>();
  });

  test("emits declarations for exported namespace constructor instances", () => {
    const diagnostics = declarationEmitDiagnostics(`
      import { idp } from "#/runtime/idp";
      import { iconv } from "#/runtime/iconv";

      export const makeClient = () => new idp.Client({ namespace: "default" });
      export const makeConverter = () => new iconv.Iconv("UTF-8", "Shift_JIS");
    `);

    expect(diagnostics).toBe("");
  });

  test("does not expose the removed file.deleteFile alias", () => {
    expect("deleteFile" in file).toBe(false);
  });
});
