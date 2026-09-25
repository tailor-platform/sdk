import path from "node:path";
import ts from "typescript";
import { expect, test } from "vitest";
import { generateUnifiedFileUtils } from "#/plugin/builtin/file-utils/generate-file-utils";

test("upload deprecates only calls whose string encoding may be omitted", () => {
  const consumerPath = path.join(import.meta.dirname, "file-upload-consumer.ts");
  const generatedPath = path.join(import.meta.dirname, "file-upload-generated.ts");
  const source = `
import { file, type FileUploadOptions } from "./file";
import { uploadFile } from "./file-upload-generated";
const target = ["ns", "Doc", "blob", "id"] as const;
const generatedTarget = ["Doc", "blob", "id"] as const;
declare const bytes: Uint8Array;
declare const mixed: string | Uint8Array;
declare const options: FileUploadOptions;
file.upload(...target, bytes);
file.upload(...target, bytes, options);
file.upload(...target, new ArrayBuffer(1));
file.upload(...target, [1, 2]);
file.upload(...target, "text", { encoding: "utf8" });
file.upload(...target, "YQ==", { encoding: "base64", contentType: "image/png" });
file.upload(...target, mixed, { encoding: "utf8" });
file.upload(...target, "text"); // deprecated
file.upload(...target, "text", { contentType: "text/plain" }); // deprecated
file.upload(...target, "text", options); // deprecated
file.upload(...target, mixed); // deprecated
if (typeof mixed !== "string") file.upload(...target, mixed);
uploadFile(...generatedTarget, bytes);
uploadFile(...generatedTarget, bytes, options);
uploadFile(...generatedTarget, "text", { encoding: "utf8" });
uploadFile(...generatedTarget, "YQ==", { encoding: "base64" });
uploadFile(...generatedTarget, mixed, { encoding: "utf8" });
uploadFile(...generatedTarget, "text"); // deprecated
uploadFile(...generatedTarget, "text", options); // deprecated
uploadFile(...generatedTarget, mixed); // deprecated
if (typeof mixed !== "string") uploadFile(...generatedTarget, mixed);
// @ts-expect-error Unsupported encoding.
file.upload(...target, "text", { encoding: "hex" });
// @ts-expect-error Unsupported encoding on generated helpers.
uploadFile(...generatedTarget, "text", { encoding: "hex" });
// @ts-expect-error Unknown file field.
uploadFile("Doc", "missing", "id", bytes);
`;
  const generated = generateUnifiedFileUtils([
    { namespace: "ns", types: [{ name: "Doc", fileFields: ["blob"] }] },
  ]).replaceAll("@tailor-platform/sdk/runtime/file", "./file");
  const files = new Map([
    [consumerPath, source],
    [generatedPath, generated],
  ]);
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    types: [],
  };
  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => [...files.keys()],
    getScriptVersion: () => "0",
    getScriptSnapshot: (name) => {
      const text = files.get(name) ?? ts.sys.readFile(name);
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => import.meta.dirname,
    getCompilationSettings: () => options,
    getDefaultLibFileName: ts.getDefaultLibFilePath,
    fileExists: (name) => files.has(name) || ts.sys.fileExists(name),
    readFile: (name) => files.get(name) ?? ts.sys.readFile(name),
  };
  const service = ts.createLanguageService(host);
  try {
    for (const name of [...files.keys(), path.join(import.meta.dirname, "file.ts")]) {
      const errors = service.getSemanticDiagnostics(name);
      expect(
        errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, "\n")),
      ).toEqual([]);
    }
    const sourceFile = service.getProgram()!.getSourceFile(consumerPath)!;
    const deprecatedLines = service
      .getSuggestionDiagnostics(consumerPath)
      .filter((diagnostic) => diagnostic.reportsDeprecated)
      .map((diagnostic) => sourceFile.getLineAndCharacterOfPosition(diagnostic.start).line);
    const expectedLines = source
      .split("\n")
      .flatMap((line, index) => (line.endsWith("// deprecated") ? [index] : []));
    expect(deprecatedLines).toEqual(expectedLines);
  } finally {
    service.dispose();
  }
});
