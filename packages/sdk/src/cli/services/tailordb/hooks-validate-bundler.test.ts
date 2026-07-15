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

const bindingsMap = (
  entries: Array<[name: string, sourceText: string, kind: SourceBinding["kind"]]>,
) =>
  new Map<string, SourceBinding>(
    entries.map(([name, sourceText, kind]) => [name, { name, sourceText, kind }]),
  );

describe("findUndefinedReferences", () => {
  test.each<[name: string, fnSource: string, expected: string[]]>([
    ["returns empty set for self-contained function", "({ value }) => value.length > 5", []],
    ["detects a single free variable", "({ value }) => value.length < MAX_LENGTH", ["MAX_LENGTH"]],
    [
      "detects multiple free variables",
      "({ data }) => formatAddress(data, PREFIX)",
      ["formatAddress", "PREFIX"],
    ],
    [
      "does not treat destructured parameters as free variables",
      "({ value, data, user }) => value + data.name + user.id",
      [],
    ],
    [
      "does not treat local variables as free variables",
      "({ value }) => { const x = 1; return value + x; }",
      [],
    ],
    [
      "detects free variables in function body with local variables",
      "({ value }) => { const x = helper(value); return x + OFFSET; }",
      ["helper", "OFFSET"],
    ],
    [
      "handles regular function syntax",
      "function({ data }) { return compute(data); }",
      ["compute"],
    ],
  ])("%s", (_name, fnSource, expected) => {
    const vars = extractFreeVariables(fnSource);
    expect(vars).toEqual(new Set(expected));
  });
});

describe("collectSourceBindings", () => {
  let tempDir: string;
  let fileCounter = 0;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), "test-bindings-"));
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const collectFromSource = (content: string) => {
    const filePath = join(tempDir, `source-${fileCounter++}.ts`);
    writeFileSync(filePath, content);
    return collectSourceBindings(filePath);
  };

  test("collects import specifiers", () => {
    const bindings = collectFromSource(
      `import { formatAddress, MAX_LENGTH } from "./helpers";\nimport defaultExport from "./mod";\n`,
    );

    expect(bindings.get("formatAddress")?.kind).toBe("import");
    expect(bindings.get("MAX_LENGTH")?.kind).toBe("import");
    expect(bindings.get("defaultExport")?.kind).toBe("import");
  });

  test("collects namespace imports", () => {
    const bindings = collectFromSource(`import * as utils from "./utils";\n`);

    expect(bindings.get("utils")?.kind).toBe("import");
  });

  test("collects top-level variable declarations", () => {
    const bindings = collectFromSource(
      `const MAX_LENGTH = 100;\nconst PREFIX = "ADDR";\nlet counter = 0;\n`,
    );

    expect(bindings.get("MAX_LENGTH")?.kind).toBe("declaration");
    expect(bindings.has("PREFIX")).toBe(true);
    expect(bindings.has("counter")).toBe(true);
  });

  test("collects top-level function declarations", () => {
    const bindings = collectFromSource(`function compute(x) { return x * 2; }\n`);

    expect(bindings.get("compute")?.kind).toBe("declaration");
  });

  test("collects exported declarations", () => {
    const bindings = collectFromSource(
      `export const TAX_RATE = 0.1;\nexport function calcTotal(price) { return price * (1 + TAX_RATE); }\n`,
    );

    expect(bindings.get("TAX_RATE")?.kind).toBe("declaration");
    expect(bindings.get("calcTotal")?.kind).toBe("declaration");
  });

  test("does not include builder chain as free variable binding", () => {
    const bindings = collectFromSource(
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

    expect(bindings.get("db")?.kind).toBe("import");
    expect(bindings.get("formatAddress")?.kind).toBe("import");
    expect(bindings.has("MAX")).toBe(true);
    expect(bindings.has("customer")).toBe(true);
  });
});

describe("resolveNeededBindings", () => {
  test("resolves import bindings for free variables", () => {
    const sourceBindings = bindingsMap([
      ["formatAddress", `import { formatAddress } from "./helpers";`, "import"],
      ["db", `import { db } from "@tailor-platform/sdk";`, "import"],
    ]);

    const freeVars = extractFreeVariables(`({ data }) => formatAddress(data)`);
    const result = resolveNeededBindings(freeVars, sourceBindings);

    expect(result.imports).toHaveLength(1);
    expect(result.imports[0]).toContain("formatAddress");
    expect(result.imports[0]).not.toContain("@tailor-platform/sdk");
    expect(result.declarations).toHaveLength(0);
  });

  test("resolves declaration bindings for free variables", () => {
    const sourceBindings = bindingsMap([["MAX_LENGTH", `const MAX_LENGTH = 100;`, "declaration"]]);

    const freeVars = extractFreeVariables(`({ value }) => value.length < MAX_LENGTH`);
    const result = resolveNeededBindings(freeVars, sourceBindings);

    expect(result.imports).toHaveLength(0);
    expect(result.declarations).toHaveLength(1);
    expect(result.declarations[0]).toBe("const MAX_LENGTH = 100;");
  });

  test("recursively resolves declaration dependencies", () => {
    const sourceBindings = bindingsMap([
      ["config", `const config = { max: 100 };`, "declaration"],
      ["MAX_LENGTH", `const MAX_LENGTH = config.max;`, "declaration"],
    ]);

    const freeVars = extractFreeVariables(`({ value }) => value.length < MAX_LENGTH`);
    const result = resolveNeededBindings(freeVars, sourceBindings);

    expect(result.declarations).toHaveLength(2);
    // Dependencies must appear before dependents (topological order)
    expect(result.declarations[0]).toBe("const config = { max: 100 };");
    expect(result.declarations[1]).toBe("const MAX_LENGTH = config.max;");
  });

  test("recursively resolves dependencies through TypeScript-typed declarations", () => {
    const addPrefixSource = `function addPrefix(value: string | null): string { return value ? \`\${LOCAL_PREFIX}\${value}\` : LOCAL_PREFIX + "unknown"; }`;
    const sourceBindings = bindingsMap([
      ["LOCAL_PREFIX", `const LOCAL_PREFIX = "item-";`, "declaration"],
      ["addPrefix", addPrefixSource, "declaration"],
    ]);

    const freeVars = extractFreeVariables(`({ value }) => addPrefix(value)`);
    const result = resolveNeededBindings(freeVars, sourceBindings);

    expect(result.declarations).toHaveLength(2);
    // Dependencies must appear before dependents (topological order)
    expect(result.declarations[0]).toBe(`const LOCAL_PREFIX = "item-";`);
    expect(result.declarations[1]).toBe(addPrefixSource);
    expect(result.unresolved).toHaveLength(0);
  });

  test("resolves mixed imports and declarations", () => {
    const sourceBindings = bindingsMap([
      ["format", `import { format } from "./format-utils";`, "import"],
      ["PREFIX", `const PREFIX = "ADDR";`, "declaration"],
      [
        "formatAddress",
        `function formatAddress(data) { return PREFIX + ": " + format(data); }`,
        "declaration",
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
    const freeVars = extractFreeVariables(`({ value }) => value > 5`);
    const result = resolveNeededBindings(freeVars, bindingsMap([]));

    expect(result.imports).toHaveLength(0);
    expect(result.declarations).toHaveLength(0);
    expect(result.unresolved).toHaveLength(0);
  });

  test("reports unresolved free variables", () => {
    const sourceBindings = bindingsMap([["MAX_LENGTH", `const MAX_LENGTH = 100;`, "declaration"]]);

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
