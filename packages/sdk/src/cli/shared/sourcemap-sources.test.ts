import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { originalPositionFor } from "@jridgewell/trace-mapping";
import * as rolldown from "rolldown";
import { afterAll, beforeAll, describe, test, expect } from "vitest";
import { assertDefined } from "#/utils/assert";
import {
  chunkCodeWithSourcemap,
  omitSourcesContent,
  sourcePackageName,
  toInlineSourcemapCode,
  type SourcemapData,
} from "./sourcemap-sources";
import { extractInlineSourcemap } from "./stack-trace";

const PNPM_SCOPED = "../p/node_modules/.pnpm/@scope+lib@1.0.0_abc/node_modules/@scope/lib/index.js";
const PNPM_PLAIN = "../p/node_modules/.pnpm/plain@2.0.0/node_modules/plain/dist/index.js";
const PNPM_GENERATED =
  "../p/node_modules/.pnpm/@prisma+client@6.0.0/node_modules/.prisma/client/index.js";
const APP = "../p/src/app.ts";

function createMap(): SourcemapData {
  return {
    version: 3,
    file: "app.js",
    sources: [PNPM_SCOPED, PNPM_PLAIN, APP],
    sourcesContent: ["scoped source", "plain source", "app source"],
    names: ["run"],
    mappings: "AAAA;ACAA;ACCA",
  };
}

function createGeneratedClientMap(): SourcemapData {
  return {
    version: 3,
    file: "app.js",
    sources: [PNPM_GENERATED, APP],
    sourcesContent: ["generated source", "app source"],
    names: [],
    mappings: "AAAA;ACAA",
  };
}

describe("sourcePackageName", () => {
  test("returns the scoped package name for a pnpm-installed source", () => {
    expect(sourcePackageName(PNPM_SCOPED)).toBe("@scope/lib");
  });

  test("returns the package name for a pnpm-installed unscoped source", () => {
    expect(sourcePackageName(PNPM_PLAIN)).toBe("plain");
  });

  test("returns the package name for a flat node_modules source", () => {
    expect(sourcePackageName("node_modules/kysely/dist/index.js")).toBe("kysely");
  });

  test("returns the innermost package for nested node_modules", () => {
    expect(sourcePackageName("node_modules/outer/node_modules/inner/index.js")).toBe("inner");
  });

  test("returns undefined for a source outside node_modules", () => {
    expect(sourcePackageName(APP)).toBeUndefined();
  });

  test("normalizes Windows path separators", () => {
    expect(sourcePackageName("..\\p\\node_modules\\@scope\\lib\\index.js")).toBe("@scope/lib");
  });
});

describe("omitSourcesContent", () => {
  test("keeps the content of a package given by name and drops the other packages", () => {
    const result = omitSourcesContent({ map: createMap(), keep: ["plain"] });

    expect(result.sourcesContent).toEqual([null, "plain source", "app source"]);
  });

  test("never drops the content of a source outside node_modules", () => {
    const result = omitSourcesContent({ map: createMap(), keep: [] });

    expect(result.sourcesContent).toEqual([null, null, "app source"]);
  });

  test("drops the content of a node_modules file that belongs to no package even when packages are kept", () => {
    const result = omitSourcesContent({
      map: createGeneratedClientMap(),
      keep: ["@prisma/client"],
    });

    expect(result.sourcesContent).toEqual([null, "app source"]);
  });

  test("keeps mappings, sources and names so stack traces still resolve", () => {
    const map = createMap();

    const result = omitSourcesContent({ map, keep: [] });

    expect(result).toMatchObject({
      version: map.version,
      file: map.file,
      sources: map.sources,
      names: map.names,
      mappings: map.mappings,
    });
  });

  test("does not mutate the input map", () => {
    const map = createMap();

    omitSourcesContent({ map, keep: ["plain"] });

    expect(map.sourcesContent).toEqual(["scoped source", "plain source", "app source"]);
  });

  test("returns the input map itself when it carries no content", () => {
    const { sourcesContent: _omitted, ...map } = createMap();

    expect(omitSourcesContent({ map, keep: [] })).toBe(map);
  });
});

describe("toInlineSourcemapCode", () => {
  test("replaces an external sourcemap reference with an inline one", () => {
    const code = "export const run = () => 1;\n\n//# sourceMappingURL=app.js.map";

    const result = toInlineSourcemapCode({ code, map: createMap() });

    expect(result).not.toContain("app.js.map");
    expect(extractInlineSourcemap(result)?.sourcesContent).toEqual([
      "scoped source",
      "plain source",
      "app source",
    ]);
  });

  test("appends an inline sourcemap when the code has no reference", () => {
    const result = toInlineSourcemapCode({ code: "export const run = () => 1;", map: createMap() });

    expect(result.startsWith("export const run = () => 1;")).toBe(true);
    expect(extractInlineSourcemap(result)).not.toBeNull();
  });

  test("replaces a reference that is followed by a trailing newline", () => {
    const code = "export const run = () => 1;\n//# sourceMappingURL=app.js.map\n";

    const result = toInlineSourcemapCode({ code, map: createMap() });

    expect(result).not.toContain("app.js.map");
    expect(result.match(/sourceMappingURL=/g)).toHaveLength(1);
  });

  test("keeps the code before the reference unchanged", () => {
    const code = "export const run = () => 1;\n\n//# sourceMappingURL=app.js.map";

    const result = toInlineSourcemapCode({ code, map: createMap() });

    expect(result.startsWith("export const run = () => 1;\n\n//# sourceMappingURL=data:")).toBe(
      true,
    );
  });
});

describe("chunkCodeWithSourcemap", () => {
  const code = "export const run = () => 1;\n\n//# sourceMappingURL=app.js.map";

  function contentOf(result: string, suffix: string): string | null | undefined {
    const traceMap = assertDefined(extractInlineSourcemap(result), "inline sourcemap missing");
    return traceMap.sourcesContent?.[
      traceMap.sources.findIndex((source) => source?.endsWith(suffix))
    ];
  }

  test("returns the chunk code as is when inline sourcemaps are disabled", () => {
    const result = chunkCodeWithSourcemap({
      chunk: { code, map: createMap() },
      inlineSourcemap: false,
      dependencySources: false,
    });

    expect(result).toBe(code);
  });

  test("returns the chunk code as is when the chunk has no map", () => {
    const result = chunkCodeWithSourcemap({
      chunk: { code, map: null },
      inlineSourcemap: true,
      dependencySources: false,
    });

    expect(result).toBe(code);
  });

  test("keeps the source text of installed packages when dependency sources are included", () => {
    const result = chunkCodeWithSourcemap({
      chunk: { code, map: createMap() },
      inlineSourcemap: true,
      dependencySources: true,
    });

    expect(contentOf(result, "@scope/lib/index.js")).toBe("scoped source");
    expect(contentOf(result, "plain/dist/index.js")).toBe("plain source");
  });

  test("drops the source text of every installed package by default", () => {
    const result = chunkCodeWithSourcemap({
      chunk: { code, map: createMap() },
      inlineSourcemap: true,
      dependencySources: false,
    });

    expect(contentOf(result, "@scope/lib/index.js")).toBeNull();
    expect(contentOf(result, "plain/dist/index.js")).toBeNull();
  });

  test("keeps the source text of only the listed packages when given a package list", () => {
    const result = chunkCodeWithSourcemap({
      chunk: { code, map: createMap() },
      inlineSourcemap: true,
      dependencySources: ["@scope/lib"],
    });

    expect(contentOf(result, "@scope/lib/index.js")).toBe("scoped source");
    expect(contentOf(result, "plain/dist/index.js")).toBeNull();
    expect(contentOf(result, "src/app.ts")).toBe("app source");
  });

  test("drops every installed package when the package list is empty", () => {
    const result = chunkCodeWithSourcemap({
      chunk: { code, map: createMap() },
      inlineSourcemap: true,
      dependencySources: [],
    });

    expect(contentOf(result, "@scope/lib/index.js")).toBeNull();
    expect(contentOf(result, "plain/dist/index.js")).toBeNull();
  });

  test("drops the source text of a file in a node_modules dot-directory by default", () => {
    const result = chunkCodeWithSourcemap({
      chunk: { code, map: createGeneratedClientMap() },
      inlineSourcemap: true,
      dependencySources: false,
    });

    expect(contentOf(result, ".prisma/client/index.js")).toBeNull();
    expect(contentOf(result, "src/app.ts")).toBe("app source");
  });

  test("keeps the source text of a file in a node_modules dot-directory when dependency sources are included", () => {
    const result = chunkCodeWithSourcemap({
      chunk: { code, map: createGeneratedClientMap() },
      inlineSourcemap: true,
      dependencySources: true,
    });

    expect(contentOf(result, ".prisma/client/index.js")).toBe("generated source");
  });

  test("keeps the source text of the project's own files", () => {
    const result = chunkCodeWithSourcemap({
      chunk: { code, map: createMap() },
      inlineSourcemap: true,
      dependencySources: false,
    });

    expect(contentOf(result, "src/app.ts")).toBe("app source");
  });

  test("replaces the external sourcemap reference with the inline one", () => {
    const result = chunkCodeWithSourcemap({
      chunk: { code, map: createMap() },
      inlineSourcemap: true,
      dependencySources: false,
    });

    expect(result).not.toContain("app.js.map");
    expect(result).toContain("//# sourceMappingURL=data:application/json");
  });
});

describe("sourcemap-sources source", () => {
  test("does not spell out an inline sourcemap comment, which build-time scanners mistake for a real one", () => {
    const source = fs.readFileSync(path.join(import.meta.dirname, "sourcemap-sources.ts"), "utf-8");

    expect(source).not.toMatch(/\/\/[#@]\s*sourceMappingURL=data:/);
  });
});

describe("with a rolldown bundle of pnpm-installed packages", () => {
  let projectDir: string;
  let code: string;
  let map: SourcemapData;

  function write(relativePath: string, content: string): void {
    const file = path.join(projectDir, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }

  beforeAll(async () => {
    projectDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "sourcemap-sources-")));
    write(
      "src/app.ts",
      'import { scoped } from "@scope/lib";\nimport { plain } from "plain";\nexport const run = () => scoped("a") + plain("b");\n',
    );
    write(
      "node_modules/.pnpm/@scope+lib@1.0.0_abc/node_modules/@scope/lib/index.js",
      "export function scoped(x) {\n  return `scoped:${x}`.toUpperCase();\n}\n",
    );
    write(
      "node_modules/.pnpm/plain@2.0.0/node_modules/plain/index.js",
      "export function plain(x) {\n  return `plain:${x}`.toLowerCase();\n}\n",
    );
    fs.mkdirSync(path.join(projectDir, "node_modules/@scope"), { recursive: true });
    fs.symlinkSync(
      "../.pnpm/@scope+lib@1.0.0_abc/node_modules/@scope/lib",
      path.join(projectDir, "node_modules/@scope/lib"),
    );
    fs.symlinkSync(
      ".pnpm/plain@2.0.0/node_modules/plain",
      path.join(projectDir, "node_modules/plain"),
    );

    const result = await rolldown.build({
      input: path.join(projectDir, "src/app.ts"),
      cwd: projectDir,
      write: false,
      logLevel: "silent",
      output: { format: "esm", sourcemap: true },
    });
    const [chunk] = result.output;
    code = chunk.code;
    map = chunk.map as SourcemapData;
  });

  afterAll(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  test("keeps only the listed package in the inlined map", () => {
    const filtered = omitSourcesContent({ map, keep: ["plain"] });

    const traceMap = assertDefined(
      extractInlineSourcemap(toInlineSourcemapCode({ code, map: filtered })),
      "inline sourcemap missing",
    );
    const contentOf = (suffix: string) =>
      traceMap.sourcesContent?.[traceMap.sources.findIndex((source) => source?.endsWith(suffix))];
    expect(contentOf("@scope/lib/index.js")).toBeNull();
    expect(contentOf("node_modules/plain/index.js")).toContain("plain:");
    expect(contentOf("src/app.ts")).toContain("export const run");
  });

  test("still resolves a position inside a dropped package", () => {
    const filtered = omitSourcesContent({ map, keep: [] });
    const line = code.split("\n").findIndex((text) => text.includes("scoped:")) + 1;

    const traceMap = assertDefined(
      extractInlineSourcemap(toInlineSourcemapCode({ code, map: filtered })),
      "inline sourcemap missing",
    );
    const position = originalPositionFor(traceMap, { line, column: 10 });

    expect(position.source).toContain("@scope+lib@1.0.0_abc/node_modules/@scope/lib/index.js");
  });
});
