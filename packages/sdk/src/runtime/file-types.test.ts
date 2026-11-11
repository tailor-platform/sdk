import path from "node:path";
import { ScriptTarget } from "typescript/ast";
import { createFileSystemLayer } from "typescript/fs";
import { ModuleKind, ModuleResolutionKind } from "typescript/sync";
import { expect, test } from "vitest";
import { generateUnifiedFileUtils } from "#/plugin/builtin/file-utils/generate-file-utils";
import { createTypeChecker, flattenDiagnosticText } from "#/utils/test-helpers/type-check";

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
  const checker = createTypeChecker();
  try {
    using snapshot = checker.api.createSnapshot({
      createPrograms: [
        {
          rootFiles: [consumerPath, generatedPath],
          compilerOptions: {
            strict: true,
            noEmit: true,
            target: ScriptTarget.ESNext,
            module: ModuleKind.ESNext,
            moduleResolution: ModuleResolutionKind.Bundler,
            types: [],
          },
        },
      ],
      fileSystem: createFileSystemLayer([
        [consumerPath, source],
        [generatedPath, generated],
      ]),
    });
    const [program] = snapshot.operation.createdPrograms;
    for (const name of [consumerPath, generatedPath, path.join(import.meta.dirname, "file.ts")]) {
      const errors = program.getSemanticDiagnostics(name);
      expect(errors.map((error) => flattenDiagnosticText(error, "\n"))).toEqual([]);
    }
    const deprecatedLines = program
      .getSuggestionDiagnostics(consumerPath)
      .filter((diagnostic) => diagnostic.reportsDeprecated)
      .map((diagnostic) => diagnostic.startPosition!.line);
    const expectedLines = source
      .split("\n")
      .flatMap((line, index) => (line.endsWith("// deprecated") ? [index] : []));
    expect(deprecatedLines).toEqual(expectedLines);
  } finally {
    checker.close();
  }
});
