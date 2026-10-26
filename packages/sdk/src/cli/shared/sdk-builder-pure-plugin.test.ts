import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";
import { describe, expect, test } from "vitest";
import { t } from "#/configure/index";
import { db } from "#/configure/services/tailordb/schema";
import { assertDefined } from "#/utils/assert";
import {
  annotateSdkBuilderCalls,
  BUILDER_FACTORIES,
  BUILDER_METHODS,
  createSdkBuilderPurePlugin,
} from "./sdk-builder-pure-plugin";
import type { TransformPluginContext } from "rolldown";

// `parse` runs validators the user wrote, and `_setRawRelation` mutates its receiver.
const NON_BUILDER_METHODS = new Set(["parse", "_setRawRelation"]);

function methodNames(value: object): string[] {
  return Object.entries(Object.getOwnPropertyDescriptors(value))
    .filter(([, descriptor]) => typeof descriptor.value === "function")
    .map(([name]) => name);
}

function fieldsOf(factories: Record<string, unknown>): object[] {
  return Object.entries(factories)
    .filter(([name]) => name !== "table" && name !== "fields")
    .map(([name, factory]) => {
      const create = factory as (arg?: unknown) => object;
      return name === "enum" ? create(["a"]) : name === "object" ? create({}) : create();
    });
}

describe("builder allowlists", () => {
  test("list every factory db and t export", () => {
    const dbPaths = [
      ...Object.keys(db).filter((name) => name !== "fields"),
      ...Object.keys(db.fields).map((name) => `fields.${name}`),
    ];

    expect(new Set(dbPaths)).toEqual(BUILDER_FACTORIES.db);
    expect(new Set(Object.keys(t))).toEqual(BUILDER_FACTORIES.t);
  });

  test("classify every method of the builders db and t create", () => {
    const builders = [
      ...fieldsOf(db),
      ...fieldsOf(t),
      ...Object.values(db.fields.timestamps()),
      db.table("User", {}),
    ];
    const methods = new Set(builders.flatMap(methodNames));

    expect(methods).toEqual(new Set([...BUILDER_METHODS, ...NON_BUILDER_METHODS]));
  });
});

const SDK_IMPORT = `import { db, t } from "@tailor-platform/sdk";\n`;

function annotate(body: string, id = "/project/src/modules.ts"): string | undefined {
  return annotateSdkBuilderCalls(SDK_IMPORT + body, id)?.code.slice(SDK_IMPORT.length);
}

describe("createSdkBuilderPurePlugin", () => {
  function transformWith(cache: Parameters<typeof createSdkBuilderPurePlugin>[0]) {
    const { transform } = createSdkBuilderPurePlugin(cache);
    if (!transform || typeof transform === "function") throw new Error("expected a filtered hook");
    return (code: string, id: string) =>
      transform.handler.call({} as TransformPluginContext, code, id, {} as never);
  }

  test("reuses the result for a module whose code is unchanged", async () => {
    const cache = new Map();
    const code = `${SDK_IMPORT}const field = db.string();\n`;
    const first = await transformWith(cache)(code, "/project/src/modules.ts");

    expect(await transformWith(cache)(code, "/project/src/modules.ts")).toBe(first);
  });

  test("annotates a module again when its code changes", async () => {
    const cache = new Map();
    await transformWith(cache)(
      `${SDK_IMPORT}const field = db.string();\n`,
      "/project/src/modules.ts",
    );

    expect(
      await transformWith(cache)(
        `${SDK_IMPORT}const field = db.uuid();\n`,
        "/project/src/modules.ts",
      ),
    ).toMatchObject({ code: expect.stringContaining("/* @__PURE__ */ db.uuid()") });
  });
});

describe("annotateSdkBuilderCalls", () => {
  test("marks a db builder chain as pure", () => {
    expect(annotate(`const field = db.string().index().unique();\n`)).toBe(
      `const field = /* @__PURE__ */ db.string().index().unique();\n`,
    );
  });

  test("marks a t builder chain as pure", () => {
    expect(annotate(`const output = t.object({ id: t.uuid() }).description("Result");\n`)).toBe(
      `const output = /* @__PURE__ */ t.object({ id: /* @__PURE__ */ t.uuid() }).description("Result");\n`,
    );
  });

  test("marks table chains and the timestamps helper as pure", () => {
    expect(
      annotate(
        `const user = db.table("User", { ...db.fields.timestamps() }).permission(p).gqlPermission(g);\n`,
      ),
    ).toBe(
      `const user = /* @__PURE__ */ db.table("User", { .../* @__PURE__ */ db.fields.timestamps() }).permission(p).gqlPermission(g);\n`,
    );
  });

  test.each([
    ["parse, which runs validators", `db.string().validate(check).parse({ value: "x" })`],
    ["a method builders do not have", `db.string().index().toString()`],
    ["a factory db does not have", `db.unknown().index()`],
    ["a factory t does not have", `t.table("User", {})`],
    ["a property read inside the chain", `db.table("User", {}).fields.id.description("x")`],
  ])("leaves a chain with %s alone", (_, chain) => {
    expect(annotate(`const value = ${chain};\n`)).toBeUndefined();
  });

  test.each([
    ["a call", `db.string().validate(check()).index()`],
    ["a call in a template literal", "db.string().description(`${label()}`).index()"],
    ["a call in a spread", `db.string().validate(...checks()).index()`],
    ["an assignment", `db.string().description((label = "x")).index()`],
    ["a new expression", `db.string().default(new Date()).index()`],
    ["a non-builder call nested in a chain", `db.string().relation(t.string().parse(x)).index()`],
  ])("leaves a chain whose inner arguments hold %s alone", (_, chain) => {
    expect(annotate(`const value = ${chain};\n`)).toBeUndefined();
  });

  test("checks computed keys in the inner arguments", () => {
    expect(annotate(`const user = db.table("User", { [key()]: db.uuid() }).permission(p);\n`)).toBe(
      `const user = db.table("User", { [key()]: /* @__PURE__ */ db.uuid() }).permission(p);\n`,
    );
  });

  test("accepts inner arguments that only read values or create functions", () => {
    const chain =
      "db.int().default(-1 as never).validate((value) => value > limits.min, [check, ...rest])" +
      '.description(`${label} (${unit ?? "none"})`).serial({ start: cond ? 1 : 2 }).index()';

    expect(annotate(`const value = ${chain};\n`)).toBe(`const value = /* @__PURE__ */ ${chain};\n`);
  });

  test("leaves the arguments of the outermost call to the bundler", () => {
    expect(annotate(`const field = db.string().description(label());\n`)).toBe(
      `const field = /* @__PURE__ */ db.string().description(label());\n`,
    );
  });

  test.each([
    ["an optional call", `db.string()?.index()`],
    ["a computed member", `db["string"]().index()`],
  ])("leaves a chain with %s alone", (_, chain) => {
    expect(annotate(`const value = ${chain};\n`)).toBeUndefined();
  });

  test.each([
    ["a function-local const", `function load() { const db = connect(); return db.string(); }`],
    ["a callback parameter", `items.map((t) => t.string());`],
    ["a destructured parameter", `items.map(({ t }) => t.string());`],
    ["a catch parameter", `try { run(); } catch (db) { db.string(); }`],
    ["a for-of variable", `for (const t of items) { t.string(); }`],
    ["a const in a switch case", `switch (kind) { case "a": const db = connect(); db.string(); }`],
    ["a class expression name", `const Model = class t { static make() { return t.string(); } };`],
    ["a const in a namespace", `namespace Models { const db = connect(); db.string(); }`],
    ["a var in a namespace", `namespace Models { if (ok) { var db = connect(); } db.string(); }`],
    [
      "a nested namespace",
      `namespace Models { export namespace t { export const x = 1; } t.string(); }`,
    ],
    ["an enum", `namespace Models { enum t { A } t.string(); }`],
    ["an import alias", `namespace Models { import t = Other.t; t.string(); }`],
    ["a const in a static block", `class Model { static { const db = connect(); db.string(); } }`],
  ])("leaves a chain on %s that shadows the import alone", (_, body) => {
    expect(annotate(`${body}\n`)).toBeUndefined();
  });

  test("marks the import again outside the shadowing scope", () => {
    expect(annotate(`function load(db) { return db; }\nconst field = db.string();\n`)).toBe(
      `function load(db) { return db; }\nconst field = /* @__PURE__ */ db.string();\n`,
    );
  });

  test("maps code after an annotation back to its original column", () => {
    const line = `const field = db.string(); throw new Error("x");`;
    const result = annotateSdkBuilderCalls(`${SDK_IMPORT}${line}\n`, "/project/src/modules.ts");
    const annotated = assertDefined(result, "expected an annotation");
    const generatedColumn = annotated.code.indexOf("throw") - SDK_IMPORT.length;

    expect(
      originalPositionFor(new TraceMap(annotated.map), { line: 2, column: generatedColumn }),
    ).toMatchObject({ line: 2, column: line.indexOf("throw") });
  });

  test("follows a renamed import", () => {
    expect(
      annotateSdkBuilderCalls(
        `import { db as schema } from "@tailor-platform/sdk";\nconst field = schema.string();\n`,
        "/project/src/modules.ts",
      )?.code,
    ).toBe(
      `import { db as schema } from "@tailor-platform/sdk";\nconst field = /* @__PURE__ */ schema.string();\n`,
    );
  });

  test.each([
    ["another module", `import { db } from "./db";\n`],
    ["an SDK subpath", `import { db } from "@tailor-platform/sdk/test";\n`],
    ["a type-only import", `import type { db } from "@tailor-platform/sdk";\n`],
    ["a type-only specifier", `import { type db } from "@tailor-platform/sdk";\n`],
  ])("leaves db imported from %s alone", (_, importLine) => {
    expect(
      annotateSdkBuilderCalls(`${importLine}const field = db.string();\n`, "/project/src/a.ts"),
    ).toBeNull();
  });

  test("leaves a chain on a table stored in a variable alone", () => {
    expect(annotate(`const user = db.table("User", {});\nuser.permission(p);\n`)).toBe(
      `const user = /* @__PURE__ */ db.table("User", {});\nuser.permission(p);\n`,
    );
  });

  test("leaves a property named db alone", () => {
    expect(annotate(`const company = modules.db.company.clone();\n`)).toBeUndefined();
  });

  test("leaves a module that does not parse alone", () => {
    expect(annotate(`const field = db.string(;\n`)).toBeUndefined();
  });

  test("parses the module in the language its extension names", () => {
    expect(annotate(`const field = <T,>(value: T) => db.string();\n`, "/project/src/a.tsx")).toBe(
      `const field = <T,>(value: T) => /* @__PURE__ */ db.string();\n`,
    );
  });
});
