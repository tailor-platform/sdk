import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "pathe";
import { describe, expect, test, beforeAll, afterAll } from "vitest";
import {
  findUndefinedReferences,
  collectSourceBindings,
  resolveNeededBindings,
  buildMinimalEntryFromResolved,
  type SourceBinding,
} from "./hooks-validate-bundler";

/**
 * Extract free variables from a function source for testing.
 * @param fnSource - The function source code.
 * @returns Set of free variable names.
 */
const extractFreeVariables = (fnSource: string) =>
  findUndefinedReferences(`const __fn = ${fnSource};`);

describe("findUndefinedReferences", () => {
  test("returns empty set for self-contained function", () => {
    const vars = extractFreeVariables("({ value }) => value.length > 5");
    expect(vars.size).toBe(0);
  });

  test("detects a single free variable", () => {
    const vars = extractFreeVariables("({ value }) => value.length < MAX_LENGTH");
    expect(vars).toEqual(new Set(["MAX_LENGTH"]));
  });

  test("detects multiple free variables", () => {
    const vars = extractFreeVariables("({ data }) => formatAddress(data, PREFIX)");
    expect(vars).toEqual(new Set(["formatAddress", "PREFIX"]));
  });

  test("does not treat destructured parameters as free variables", () => {
    const vars = extractFreeVariables("({ value, data, user }) => value + data.name + user.id");
    expect(vars.size).toBe(0);
  });

  test("does not treat local variables as free variables", () => {
    const vars = extractFreeVariables("({ value }) => { const x = 1; return value + x; }");
    expect(vars.size).toBe(0);
  });

  test("detects free variables in function body with local variables", () => {
    const vars = extractFreeVariables(
      "({ value }) => { const x = helper(value); return x + OFFSET; }",
    );
    expect(vars).toEqual(new Set(["helper", "OFFSET"]));
  });

  test("handles regular function syntax", () => {
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

  test("collects import specifiers", () => {
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

  test("collects namespace imports", () => {
    const filePath = join(tempDir, "namespace.ts");
    writeFileSync(filePath, `import * as utils from "./utils";\n`);

    const bindings = collectSourceBindings(filePath);

    expect(bindings.has("utils")).toBe(true);
    expect(bindings.get("utils")?.kind).toBe("import");
  });

  test("collects top-level variable declarations", () => {
    const filePath = join(tempDir, "vars.ts");
    writeFileSync(filePath, `const MAX_LENGTH = 100;\nconst PREFIX = "ADDR";\nlet counter = 0;\n`);

    const bindings = collectSourceBindings(filePath);

    expect(bindings.has("MAX_LENGTH")).toBe(true);
    expect(bindings.get("MAX_LENGTH")?.kind).toBe("declaration");
    expect(bindings.has("PREFIX")).toBe(true);
    expect(bindings.has("counter")).toBe(true);
  });

  test("collects top-level function declarations", () => {
    const filePath = join(tempDir, "funcs.ts");
    writeFileSync(filePath, `function compute(x) { return x * 2; }\n`);

    const bindings = collectSourceBindings(filePath);

    expect(bindings.has("compute")).toBe(true);
    expect(bindings.get("compute")?.kind).toBe("declaration");
  });

  test("collects exported declarations", () => {
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

  test("does not include builder chain as free variable binding", () => {
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
  test("resolves import bindings for free variables", () => {
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

    const freeVars = extractFreeVariables(`({ data }) => formatAddress(data)`);
    const result = resolveNeededBindings(freeVars, sourceBindings);

    expect(result.imports).toHaveLength(1);
    expect(result.imports[0]).toContain("formatAddress");
    expect(result.imports[0]).not.toContain("@tailor-platform/sdk");
    expect(result.declarations).toHaveLength(0);
  });

  test("resolves declaration bindings for free variables", () => {
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

    const freeVars = extractFreeVariables(`({ value }) => value.length < MAX_LENGTH`);
    const result = resolveNeededBindings(freeVars, sourceBindings);

    expect(result.imports).toHaveLength(0);
    expect(result.declarations).toHaveLength(1);
    expect(result.declarations[0]).toBe("const MAX_LENGTH = 100;");
  });

  test("recursively resolves declaration dependencies", () => {
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

    const freeVars = extractFreeVariables(`({ value }) => value.length < MAX_LENGTH`);
    const result = resolveNeededBindings(freeVars, sourceBindings);

    expect(result.declarations).toHaveLength(2);
    // Dependencies must appear before dependents (topological order)
    expect(result.declarations[0]).toBe("const config = { max: 100 };");
    expect(result.declarations[1]).toBe("const MAX_LENGTH = config.max;");
  });

  test("recursively resolves dependencies through TypeScript-typed declarations", () => {
    const sourceBindings = new Map<string, SourceBinding>([
      [
        "LOCAL_PREFIX",
        {
          name: "LOCAL_PREFIX",
          sourceText: `const LOCAL_PREFIX = "item-";`,
          kind: "declaration",
        },
      ],
      [
        "addPrefix",
        {
          name: "addPrefix",
          sourceText: `function addPrefix(value: string | null): string { return value ? \`\${LOCAL_PREFIX}\${value}\` : LOCAL_PREFIX + "unknown"; }`,
          kind: "declaration",
        },
      ],
    ]);

    const freeVars = extractFreeVariables(`({ value }) => addPrefix(value)`);
    const result = resolveNeededBindings(freeVars, sourceBindings);

    expect(result.declarations).toHaveLength(2);
    // Dependencies must appear before dependents (topological order)
    expect(result.declarations[0]).toBe(`const LOCAL_PREFIX = "item-";`);
    expect(result.declarations[1]).toBe(
      `function addPrefix(value: string | null): string { return value ? \`\${LOCAL_PREFIX}\${value}\` : LOCAL_PREFIX + "unknown"; }`,
    );
    expect(result.unresolved).toHaveLength(0);
  });

  test("resolves mixed imports and declarations", () => {
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

    const freeVars = extractFreeVariables(`({ data }) => formatAddress(data)`);
    const result = resolveNeededBindings(freeVars, sourceBindings);

    // Should include: formatAddress (direct), PREFIX (via formatAddress), format import (via formatAddress)
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0]).toContain("format");
    // Dependencies must appear before dependents (topological order)
    expect(result.declarations[0]).toBe(`const PREFIX = "ADDR";`);
    expect(result.declarations[1]).toBe(
      `function formatAddress(data) { return PREFIX + ": " + format(data); }`,
    );
  });

  test("returns empty when no free variables", () => {
    const sourceBindings = new Map<string, SourceBinding>();
    const freeVars = extractFreeVariables(`({ value }) => value > 5`);
    const result = resolveNeededBindings(freeVars, sourceBindings);

    expect(result.imports).toHaveLength(0);
    expect(result.declarations).toHaveLength(0);
    expect(result.unresolved).toHaveLength(0);
  });

  test("reports unresolved free variables", () => {
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

    const freeVars = extractFreeVariables(
      `({ value }) => externalFn(value) && value.length < MAX_LENGTH`,
    );
    const result = resolveNeededBindings(freeVars, sourceBindings);

    expect(result.declarations).toHaveLength(1);
    expect(result.unresolved).toEqual(["externalFn"]);
  });
});

describe("buildMinimalEntryFromResolved", () => {
  test("resolves relative import paths to absolute", () => {
    const entry = buildMinimalEntryFromResolved(
      [`import { formatAddress } from "./helpers";`],
      [],
      `({ data }) => formatAddress(data)`,
      "/project/src/customer.ts",
    );

    expect(entry).toContain("formatAddress");
    expect(entry).toContain("/project/src/helpers");
    expect(entry).toContain("export function main(input)");
  });

  test("includes declarations in entry", () => {
    const entry = buildMinimalEntryFromResolved(
      [],
      [`const MAX_LENGTH = 100;`],
      `({ value }) => value.length < MAX_LENGTH`,
      "/project/src/customer.ts",
    );

    expect(entry).toContain("const MAX_LENGTH = 100;");
    expect(entry).toContain("export function main(input)");
  });

  test("builds entry with no imports or declarations", () => {
    const entry = buildMinimalEntryFromResolved(
      [],
      [],
      `({ value }) => value > 5`,
      "/project/src/customer.ts",
    );

    expect(entry).toBe(`export function main(input) { return (({ value }) => value > 5)(input); }`);
  });

  test("does not rewrite non-relative import paths", () => {
    const entry = buildMinimalEntryFromResolved(
      [`import { db } from "@tailor-platform/sdk";`],
      [],
      `({ data }) => data`,
      "/project/src/customer.ts",
    );

    expect(entry).toContain(`from "@tailor-platform/sdk"`);
  });
});
