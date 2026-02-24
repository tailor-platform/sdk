import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "pathe";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import {
  extractFreeVariables,
  collectSourceBindings,
  resolveNeededBindings,
  buildMinimalEntry,
  type SourceBinding,
} from "./script-precompiler";

describe("extractFreeVariables", () => {
  it("returns empty set for self-contained function", () => {
    const vars = extractFreeVariables("({ value }) => value.length > 5");
    expect(vars.size).toBe(0);
  });

  it("detects a single free variable", () => {
    const vars = extractFreeVariables("({ value }) => value.length < MAX_LENGTH");
    expect(vars).toEqual(new Set(["MAX_LENGTH"]));
  });

  it("detects multiple free variables", () => {
    const vars = extractFreeVariables("({ data }) => formatAddress(data, PREFIX)");
    expect(vars).toEqual(new Set(["formatAddress", "PREFIX"]));
  });

  it("does not treat destructured parameters as free variables", () => {
    const vars = extractFreeVariables("({ value, data, user }) => value + data.name + user.id");
    expect(vars.size).toBe(0);
  });

  it("does not treat local variables as free variables", () => {
    const vars = extractFreeVariables("({ value }) => { const x = 1; return value + x; }");
    expect(vars.size).toBe(0);
  });

  it("detects free variables in function body with local variables", () => {
    const vars = extractFreeVariables(
      "({ value }) => { const x = helper(value); return x + OFFSET; }",
    );
    expect(vars).toEqual(new Set(["helper", "OFFSET"]));
  });

  it("handles regular function syntax", () => {
    const vars = extractFreeVariables("function({ data }) { return compute(data); }");
    expect(vars).toEqual(new Set(["compute"]));
  });
});

describe("collectSourceBindings", () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), "test-bindings-"));
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("collects import specifiers", () => {
    const filePath = join(tempDir, "imports.ts");
    writeFileSync(
      filePath,
      `import { formatAddress, MAX_LENGTH } from "./helpers";\nimport defaultExport from "./mod";\n`,
    );

    const bindings = collectSourceBindings(filePath);

    expect(bindings.has("formatAddress")).toBe(true);
    expect(bindings.get("formatAddress")?.kind).toBe("import");
    expect(bindings.has("MAX_LENGTH")).toBe(true);
    expect(bindings.get("MAX_LENGTH")?.kind).toBe("import");
    expect(bindings.has("defaultExport")).toBe(true);
    expect(bindings.get("defaultExport")?.kind).toBe("import");
  });

  it("collects namespace imports", () => {
    const filePath = join(tempDir, "namespace.ts");
    writeFileSync(filePath, `import * as utils from "./utils";\n`);

    const bindings = collectSourceBindings(filePath);

    expect(bindings.has("utils")).toBe(true);
    expect(bindings.get("utils")?.kind).toBe("import");
  });

  it("collects top-level variable declarations", () => {
    const filePath = join(tempDir, "vars.ts");
    writeFileSync(filePath, `const MAX_LENGTH = 100;\nconst PREFIX = "ADDR";\nlet counter = 0;\n`);

    const bindings = collectSourceBindings(filePath);

    expect(bindings.has("MAX_LENGTH")).toBe(true);
    expect(bindings.get("MAX_LENGTH")?.kind).toBe("declaration");
    expect(bindings.has("PREFIX")).toBe(true);
    expect(bindings.has("counter")).toBe(true);
  });

  it("collects top-level function declarations", () => {
    const filePath = join(tempDir, "funcs.ts");
    writeFileSync(filePath, `function compute(x) { return x * 2; }\n`);

    const bindings = collectSourceBindings(filePath);

    expect(bindings.has("compute")).toBe(true);
    expect(bindings.get("compute")?.kind).toBe("declaration");
  });

  it("collects exported declarations", () => {
    const filePath = join(tempDir, "exports.ts");
    writeFileSync(
      filePath,
      `export const TAX_RATE = 0.1;\nexport function calcTotal(price) { return price * (1 + TAX_RATE); }\n`,
    );

    const bindings = collectSourceBindings(filePath);

    expect(bindings.has("TAX_RATE")).toBe(true);
    expect(bindings.get("TAX_RATE")?.kind).toBe("declaration");
    expect(bindings.has("calcTotal")).toBe(true);
    expect(bindings.get("calcTotal")?.kind).toBe("declaration");
  });

  it("does not include builder chain as free variable binding", () => {
    const filePath = join(tempDir, "type.ts");
    writeFileSync(
      filePath,
      [
        `import { db } from "@tailor-platform/sdk";`,
        `import { formatAddress } from "./helpers";`,
        `const MAX = 100;`,
        `export const customer = db.type("Customer", {`,
        `  name: db.string(),`,
        `}).hooks({ fullAddress: { create: ({ data }) => formatAddress(data) } });`,
        ``,
      ].join("\n"),
    );

    const bindings = collectSourceBindings(filePath);

    // Should have db, formatAddress, MAX, customer
    expect(bindings.has("db")).toBe(true);
    expect(bindings.get("db")?.kind).toBe("import");
    expect(bindings.has("formatAddress")).toBe(true);
    expect(bindings.get("formatAddress")?.kind).toBe("import");
    expect(bindings.has("MAX")).toBe(true);
    expect(bindings.has("customer")).toBe(true);
  });
});

describe("resolveNeededBindings", () => {
  it("resolves import bindings for free variables", () => {
    const sourceBindings = new Map<string, SourceBinding>([
      [
        "formatAddress",
        {
          name: "formatAddress",
          sourceText: `import { formatAddress } from "./helpers";`,
          kind: "import",
        },
      ],
      [
        "db",
        {
          name: "db",
          sourceText: `import { db } from "@tailor-platform/sdk";`,
          kind: "import",
        },
      ],
    ]);

    const result = resolveNeededBindings(`({ data }) => formatAddress(data)`, sourceBindings);

    expect(result.imports).toHaveLength(1);
    expect(result.imports[0]).toContain("formatAddress");
    expect(result.imports[0]).not.toContain("@tailor-platform/sdk");
    expect(result.declarations).toHaveLength(0);
  });

  it("resolves declaration bindings for free variables", () => {
    const sourceBindings = new Map<string, SourceBinding>([
      [
        "MAX_LENGTH",
        {
          name: "MAX_LENGTH",
          sourceText: `const MAX_LENGTH = 100;`,
          kind: "declaration",
        },
      ],
    ]);

    const result = resolveNeededBindings(
      `({ value }) => value.length < MAX_LENGTH`,
      sourceBindings,
    );

    expect(result.imports).toHaveLength(0);
    expect(result.declarations).toHaveLength(1);
    expect(result.declarations[0]).toBe("const MAX_LENGTH = 100;");
  });

  it("recursively resolves declaration dependencies", () => {
    const sourceBindings = new Map<string, SourceBinding>([
      [
        "config",
        {
          name: "config",
          sourceText: `const config = { max: 100 };`,
          kind: "declaration",
        },
      ],
      [
        "MAX_LENGTH",
        {
          name: "MAX_LENGTH",
          sourceText: `const MAX_LENGTH = config.max;`,
          kind: "declaration",
        },
      ],
    ]);

    const result = resolveNeededBindings(
      `({ value }) => value.length < MAX_LENGTH`,
      sourceBindings,
    );

    expect(result.declarations).toHaveLength(2);
    expect(result.declarations).toContain("const MAX_LENGTH = config.max;");
    expect(result.declarations).toContain("const config = { max: 100 };");
  });

  it("resolves mixed imports and declarations", () => {
    const sourceBindings = new Map<string, SourceBinding>([
      [
        "format",
        {
          name: "format",
          sourceText: `import { format } from "./format-utils";`,
          kind: "import",
        },
      ],
      [
        "PREFIX",
        {
          name: "PREFIX",
          sourceText: `const PREFIX = "ADDR";`,
          kind: "declaration",
        },
      ],
      [
        "formatAddress",
        {
          name: "formatAddress",
          sourceText: `function formatAddress(data) { return PREFIX + ": " + format(data); }`,
          kind: "declaration",
        },
      ],
    ]);

    const result = resolveNeededBindings(`({ data }) => formatAddress(data)`, sourceBindings);

    // Should include: formatAddress (direct), PREFIX (via formatAddress), format import (via formatAddress)
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0]).toContain("format");
    expect(result.declarations).toContain(
      `function formatAddress(data) { return PREFIX + ": " + format(data); }`,
    );
    expect(result.declarations).toContain(`const PREFIX = "ADDR";`);
  });

  it("returns empty when no free variables", () => {
    const sourceBindings = new Map<string, SourceBinding>();
    const result = resolveNeededBindings(`({ value }) => value > 5`, sourceBindings);

    expect(result.imports).toHaveLength(0);
    expect(result.declarations).toHaveLength(0);
    expect(result.unresolved).toHaveLength(0);
  });

  it("reports unresolved free variables", () => {
    const sourceBindings = new Map<string, SourceBinding>([
      [
        "MAX_LENGTH",
        {
          name: "MAX_LENGTH",
          sourceText: `const MAX_LENGTH = 100;`,
          kind: "declaration",
        },
      ],
    ]);

    const result = resolveNeededBindings(
      `({ value }) => externalFn(value) && value.length < MAX_LENGTH`,
      sourceBindings,
    );

    expect(result.declarations).toHaveLength(1);
    expect(result.unresolved).toEqual(["externalFn"]);
  });
});

describe("buildMinimalEntry", () => {
  it("builds entry with import and function", () => {
    const sourceBindings = new Map<string, SourceBinding>([
      [
        "formatAddress",
        {
          name: "formatAddress",
          sourceText: `import { formatAddress } from "./helpers";`,
          kind: "import",
        },
      ],
    ]);

    const { entry, unresolved } = buildMinimalEntry(
      `({ data }) => formatAddress(data)`,
      "/project/src/customer.ts",
      sourceBindings,
    );

    // Should contain the import (with resolved path) and export
    expect(entry).toContain("formatAddress");
    expect(entry).toContain("/project/src/helpers");
    expect(entry).toContain("export function main(input)");
    expect(unresolved).toHaveLength(0);
  });

  it("builds entry with declaration and function", () => {
    const sourceBindings = new Map<string, SourceBinding>([
      [
        "MAX_LENGTH",
        {
          name: "MAX_LENGTH",
          sourceText: `const MAX_LENGTH = 100;`,
          kind: "declaration",
        },
      ],
    ]);

    const { entry, unresolved } = buildMinimalEntry(
      `({ value }) => value.length < MAX_LENGTH`,
      "/project/src/customer.ts",
      sourceBindings,
    );

    expect(entry).toContain("const MAX_LENGTH = 100;");
    expect(entry).toContain("export function main(input)");
    // Should NOT contain any SDK imports
    expect(entry).not.toContain("@tailor-platform/sdk");
    expect(unresolved).toHaveLength(0);
  });

  it("builds entry for function with no free variables", () => {
    const sourceBindings = new Map<string, SourceBinding>();

    const { entry, unresolved } = buildMinimalEntry(
      `({ value }) => value > 5`,
      "/project/src/customer.ts",
      sourceBindings,
    );

    expect(entry).toBe(`export function main(input) { return (({ value }) => value > 5)(input); }`);
    expect(unresolved).toHaveLength(0);
  });

  it("reports unresolved free variables", () => {
    const sourceBindings = new Map<string, SourceBinding>();

    const { unresolved } = buildMinimalEntry(
      `({ data }) => unknownFn(data)`,
      "/project/src/customer.ts",
      sourceBindings,
    );

    expect(unresolved).toEqual(["unknownFn"]);
  });
});
