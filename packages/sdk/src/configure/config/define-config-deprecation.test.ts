import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

const DEPRECATED_CODES = new Set([6385, 6386, 6387]);

function deprecatedLines(probe: string): number[] {
  const dir = mkdtempSync(join(tmpdir(), "tailor-define-config-deprecation-"));
  tempDirs.push(dir);
  const probeFile = join(dir, "probe.ts");
  writeFileSync(probeFile, probe);

  const options: ts.CompilerOptions = {
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    paths: { "@tailor-platform/sdk": [join(SDK_SRC, "configure", "index.ts")] },
  };
  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => [probeFile],
    getScriptVersion: () => "1",
    getScriptSnapshot: (fileName) =>
      ts.sys.fileExists(fileName)
        ? ts.ScriptSnapshot.fromString(ts.sys.readFile(fileName) ?? "")
        : undefined,
    getCurrentDirectory: () => dir,
    getCompilationSettings: () => options,
    getDefaultLibFileName: ts.getDefaultLibFilePath,
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };
  const service = ts.createLanguageService(host);
  const sourceFile = ts.createSourceFile(probeFile, probe, ts.ScriptTarget.ES2022);
  return service
    .getSuggestionDiagnostics(probeFile)
    .filter((diagnostic) => DEPRECATED_CODES.has(diagnostic.code))
    .map((diagnostic) => ts.getLineAndCharacterOfPosition(sourceFile, diagnostic.start).line + 1);
}

describe("defineConfig idp deprecation", () => {
  test("reports the array form of idp as deprecated and leaves the single form alone", () => {
    const probe = [
      'import { defineConfig, defineIdp } from "@tailor-platform/sdk";',
      'const idp = defineIdp("my-idp", { clients: ["my-client"] });',
      'export const single = defineConfig({ name: "a", idp });',
      'export const external = defineConfig({ name: "a", idp: { name: "shared-idp", external: true } });',
      'export const none = defineConfig({ name: "a" });',
      'export const array = defineConfig({ name: "a", idp: [idp] });',
      "declare const enabled: boolean;",
      'export const either = defineConfig({ name: "a", idp: enabled ? [idp] : undefined });',
    ].join("\n");

    expect(deprecatedLines(probe)).toEqual([6]);
  });
});
