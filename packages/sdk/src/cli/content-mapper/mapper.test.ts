import * as fs from "node:fs";
import * as path from "pathe";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { precompileTailorDBTypeScripts } from "#/cli/services/tailordb/hooks-validate-bundler";
import { silenceLogger } from "#/cli/shared/test-helpers/silence-logger";
import { makeTempDir } from "#/cli/shared/test-helpers/temp-dir";
import { createContentMapperHandlers, evaluateConfigInProcess, type Evaluation } from "./mapper";
import type * as HooksValidateBundler from "#/cli/services/tailordb/hooks-validate-bundler";

vi.mock("#/cli/services/tailordb/hooks-validate-bundler", async (importOriginal) => {
  const actual = await importOriginal<typeof HooksValidateBundler>();
  return {
    ...actual,
    precompileTailorDBTypeScripts: vi.fn(actual.precompileTailorDBTypeScripts),
  };
});

const REGISTRY_FILE = "/node_modules/@tailor-platform/sdk/dist/configure/registry.tailor";

const CONFIG = `import { defineConfig } from "@tailor-platform/sdk";
export default defineConfig({ name: "app", env: { stage: "dev" } });
`;

// Inside the package, so the project's `@tailor-platform/sdk` imports resolve to its build.
function project(): Disposable & { dir: string; config: string; tsconfig: string } {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(import.meta.dirname, ".sdk-content-mapper-")),
  );
  const config = path.join(dir, "tailor.config.ts");
  fs.writeFileSync(config, CONFIG);
  return {
    dir,
    config,
    tsconfig: path.join(dir, "tsconfig.json"),
    [Symbol.dispose]() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

const DB_FILE = "/node_modules/@tailor-platform/sdk/dist/plugin/builtin/kysely-type/db.tailor";

const ORDER_TABLE_CONFIG = `import { defineConfig, definePlugins } from "@tailor-platform/sdk";
import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";
export default defineConfig({ name: "app", db: { main: { files: ["./tailordb/*.ts"] } } });
export const plugins = definePlugins(kyselyTypePlugin({ contentMapper: true, temporal: true }));
`;

const ORDER_TABLE = `import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";
export const order = db
  .table("Order", { status: db.enum(["PAID", "OPEN"]) })
  .permission(unsafeAllowAllTypePermission)
  .gqlPermission(unsafeAllowAllGqlPermission);
`;

function projectWithOrderTable(): ReturnType<typeof project> {
  const p = project();
  fs.writeFileSync(p.config, ORDER_TABLE_CONFIG);
  fs.mkdirSync(path.join(p.dir, "tailordb"));
  fs.writeFileSync(path.join(p.dir, "tailordb", "order.ts"), ORDER_TABLE);
  return p;
}

const HOOKED_ORDER_TABLE = `import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";
export const order = db
  .table("Order", { status: db.string().hooks({ create: ({ value }) => value ?? "OPEN" }) })
  .permission(unsafeAllowAllTypePermission)
  .gqlPermission(unsafeAllowAllGqlPermission);
`;

function projectWithHookedOrderTable(): ReturnType<typeof project> {
  const p = projectWithOrderTable();
  fs.writeFileSync(path.join(p.dir, "tailordb", "order.ts"), HOOKED_ORDER_TABLE);
  return p;
}

function projectWithoutTables(): ReturnType<typeof project> {
  const p = project();
  fs.writeFileSync(p.config, ORDER_TABLE_CONFIG);
  fs.mkdirSync(path.join(p.dir, "tailordb"));
  return p;
}

function ancestors(dir: string): string[] {
  const parent = path.dirname(dir);
  return parent === dir ? [] : [parent, ...ancestors(parent)];
}

type Handlers = ReturnType<typeof createContentMapperHandlers>;

async function open(handlers: Handlers, configFileName: string, options?: unknown) {
  return (await handlers.openProject({
    configFileName,
    projectHandle: "p1",
    compilerOptions: {},
    ...(options === undefined ? {} : { options }),
  })) as { configIdentity: string; watchedFiles: string[]; optionDiagnostics: unknown[] };
}

async function transform(handlers: Handlers, content: string, fileName: string) {
  return (await handlers.transform({ fileName, content, projectHandle: "p1" })) as {
    text: string;
    extension: string;
    diagnostics: { messageText: string; start: number; length: number; code: number }[];
    mappings: number[][];
  };
}

describe("content mapper", () => {
  beforeEach(() => {
    vi.mocked(precompileTailorDBTypeScripts).mockClear();
  });

  test("types registry.tailor with the registries of the project's tailor.config.ts", async () => {
    using p = project();
    const handlers = createContentMapperHandlers(evaluateConfigInProcess);
    await handlers.initialize({ positionEncodings: ["utf-16"] });

    const opened = await open(handlers, p.tsconfig);
    const result = await transform(handlers, "// note\n", REGISTRY_FILE);

    expect(opened).toEqual({
      configIdentity: expect.any(String),
      watchedFiles: expect.arrayContaining([p.config]),
      optionDiagnostics: [],
    });
    expect(result).toEqual({
      extension: ".ts",
      text: expect.stringContaining('declare module "@tailor-platform/sdk"'),
      diagnostics: [],
      mappings: [[0, result.text.length, 0, "// note\n".length, 1, 24]],
    });
    expect(result.text).toContain("stage: string;");
    expect(result.text).toContain('app: "unset";');
  });

  test("types a .tailor file of any other name as an empty module", async () => {
    using p = project();
    const handlers = createContentMapperHandlers(evaluateConfigInProcess);
    await handlers.initialize({ positionEncodings: ["utf-16"] });
    await open(handlers, p.tsconfig);

    const result = await transform(handlers, "", "/other.tailor");

    expect(result.text).toBe("export {};\n");
    expect(result.diagnostics).toEqual([]);
  });

  test("types db.tailor with the Kysely types of the project's TailorDB definitions", async () => {
    using p = projectWithOrderTable();
    const handlers = createContentMapperHandlers(evaluateConfigInProcess);
    await handlers.initialize({ positionEncodings: ["utf-16"] });
    await open(handlers, p.tsconfig);

    const result = await transform(handlers, "// note\n", DB_FILE);

    expect(result).toEqual({
      extension: ".ts",
      text: expect.stringContaining("export interface Namespace"),
      diagnostics: [],
      mappings: [[0, result.text.length, 0, "// note\n".length, 1, 24]],
    });
    expect(result.text).toContain('status: "PAID" | "OPEN";');
    expect(result.text).toContain("createGetDB<Namespace>({ temporal: true })");
  });

  test("types db.tailor without bundling the hook and validator scripts of the tables it reads", async () => {
    using p = projectWithHookedOrderTable();
    const handlers = createContentMapperHandlers(evaluateConfigInProcess);
    await handlers.initialize({ positionEncodings: ["utf-16"] });
    await open(handlers, p.tsconfig);

    const result = await transform(handlers, "", DB_FILE);

    expect(result.text).toContain("status: Generated<string>;");
    expect(precompileTailorDBTypeScripts).not.toHaveBeenCalled();
  });

  test("types db.tailor as a module that exports getDB over no namespaces, without a diagnostic, when the project defines no tables yet", async () => {
    using p = projectWithoutTables();
    const handlers = createContentMapperHandlers(evaluateConfigInProcess);
    await handlers.initialize({ positionEncodings: ["utf-16"] });
    await open(handlers, p.tsconfig);

    const result = await transform(handlers, "", DB_FILE);

    expect(result.text).toContain("export interface Namespace {}");
    expect(result.text).toContain(
      "export const getDB = createGetDB<Namespace>({ temporal: true })",
    );
    expect(result.diagnostics).toEqual([]);
  });

  test("reports db.tailor when tailor.config.ts does not configure kyselyTypePlugin, and still types registry.tailor", async () => {
    using p = project();
    const handlers = createContentMapperHandlers(evaluateConfigInProcess);
    await handlers.initialize({ positionEncodings: ["utf-16"] });
    await open(handlers, p.tsconfig);

    const db = await transform(handlers, "", DB_FILE);
    const registry = await transform(handlers, "", REGISTRY_FILE);

    expect(db.diagnostics).toEqual([
      { messageText: expect.stringContaining("kyselyTypePlugin"), start: 0, length: 0, code: 2 },
    ]);
    expect(db.text).toBe("export {};\n");
    expect(registry.diagnostics).toEqual([]);
  });

  test("reports db.tailor when kyselyTypePlugin writes a generated file instead of setting contentMapper", async () => {
    using p = projectWithOrderTable();
    fs.writeFileSync(
      p.config,
      ORDER_TABLE_CONFIG.replace("contentMapper: true", 'distPath: "./generated/db.ts"'),
    );
    const handlers = createContentMapperHandlers(evaluateConfigInProcess);
    await handlers.initialize({ positionEncodings: ["utf-16"] });
    await open(handlers, p.tsconfig);

    const db = await transform(handlers, "", DB_FILE);

    expect(db.diagnostics).toEqual([
      {
        messageText: expect.stringContaining("contentMapper: true"),
        start: 0,
        length: 0,
        code: 2,
      },
    ]);
    expect(db.text).toBe("export {};\n");
  });

  test("reports db.tailor when a TailorDB definition fails to load, and still types registry.tailor", async () => {
    using p = projectWithOrderTable();
    const handlers = createContentMapperHandlers(evaluateConfigInProcess);
    await handlers.initialize({ positionEncodings: ["utf-16"] });
    await open(handlers, p.tsconfig);

    fs.writeFileSync(path.join(p.dir, "tailordb", "order.ts"), "export const order = ;\n");
    using _logger = silenceLogger("error");
    const opened = await open(handlers, p.tsconfig);

    const db = await transform(handlers, "", DB_FILE);
    const registry = await transform(handlers, "", REGISTRY_FILE);

    expect(opened.configIdentity).toEqual(expect.any(String));
    expect(db.diagnostics).toEqual([
      { messageText: expect.stringContaining("order.ts"), start: 0, length: 0, code: 2 },
    ]);
    expect(registry.diagnostics).toEqual([]);
  });

  test("keeps watching the files of the last good evaluation when a TailorDB definition fails to load", async () => {
    using p = project();
    const order = path.join(p.dir, "tailordb", "order.ts");
    const evaluations: Evaluation[] = [
      { registryTypes: "export {};\n", kyselyTypes: "export {};\n", files: [order] },
      { registryTypes: "export {};\n", kyselyError: "order.ts: unexpected token", files: [] },
    ];
    const handlers = createContentMapperHandlers(() => Promise.resolve(evaluations.shift()!));
    await handlers.initialize({ positionEncodings: ["utf-16"] });
    await open(handlers, p.tsconfig);

    const opened = await open(handlers, p.tsconfig);

    expect(opened.watchedFiles).toEqual(expect.arrayContaining([p.config, order]));
  });

  test("changes its identity and db.tailor types when a TailorDB definition changes", async () => {
    using p = projectWithOrderTable();
    const handlers = createContentMapperHandlers(evaluateConfigInProcess);
    await handlers.initialize({ positionEncodings: ["utf-16"] });
    const before = await open(handlers, p.tsconfig);

    fs.writeFileSync(
      path.join(p.dir, "tailordb", "order.ts"),
      ORDER_TABLE.replace('["PAID", "OPEN"]', '["PAID", "OPEN", "VOID"]'),
    );
    const after = await open(handlers, p.tsconfig);

    expect(after.configIdentity).not.toBe(before.configIdentity);
    expect((await transform(handlers, "", DB_FILE)).text).toContain(
      'status: "PAID" | "OPEN" | "VOID";',
    );
  });

  test("changes its identity and types when the config changes", async () => {
    using p = project();
    const handlers = createContentMapperHandlers(evaluateConfigInProcess);
    await handlers.initialize({ positionEncodings: ["utf-16"] });
    const before = await open(handlers, p.tsconfig);

    fs.writeFileSync(p.config, CONFIG.replace('stage: "dev"', 'stage: "dev", region: "tokyo"'));
    const after = await open(handlers, p.tsconfig);

    expect(after.configIdentity).not.toBe(before.configIdentity);
    expect((await transform(handlers, "", REGISTRY_FILE)).text).toContain("region: string;");
  });

  test("reports a config that fails to load on the file and keeps watching it", async () => {
    using p = project();
    const handlers = createContentMapperHandlers(evaluateConfigInProcess);
    await handlers.initialize({ positionEncodings: ["utf-16"] });
    await open(handlers, p.tsconfig);

    fs.writeFileSync(p.config, "export default ;\n");
    using _logger = silenceLogger("error");
    const opened = await open(handlers, p.tsconfig);
    const result = await transform(handlers, "", REGISTRY_FILE);

    expect(opened.watchedFiles).toEqual(expect.arrayContaining([p.config]));
    expect(result.diagnostics).toEqual([
      { messageText: expect.stringContaining("tailor.config.ts"), start: 0, length: 0, code: 2 },
    ]);
  });

  test("watches the tailor.config.ts a nearer directory could add above the one it uses", async () => {
    using p = project();
    const nested = path.join(p.dir, "packages", "app");
    fs.mkdirSync(nested, { recursive: true });
    const handlers = createContentMapperHandlers(evaluateConfigInProcess);
    await handlers.initialize({ positionEncodings: ["utf-16"] });

    const opened = await open(handlers, path.join(nested, "tsconfig.json"));

    expect(opened.watchedFiles).toEqual(
      expect.arrayContaining([
        p.config,
        path.join(nested, "tailor.config.ts"),
        path.join(p.dir, "packages", "tailor.config.ts"),
      ]),
    );
  });

  test("reports a project without tailor.config.ts and watches for one", async () => {
    const dir = makeTempDir("sdk-content-mapper-no-config-");
    try {
      const handlers = createContentMapperHandlers(evaluateConfigInProcess);
      await handlers.initialize({ positionEncodings: ["utf-16"] });
      const opened = await open(handlers, path.join(dir, "tsconfig.json"));
      const result = await transform(handlers, "", REGISTRY_FILE);

      expect(opened.watchedFiles).toEqual([
        path.join(dir, "tailor.config.ts"),
        ...ancestors(dir).map((ancestor) => path.join(ancestor, "tailor.config.ts")),
      ]);
      expect(result.diagnostics).toEqual([
        {
          messageText: `No tailor.config.ts found in ${dir} or its parent directories`,
          start: 0,
          length: 0,
          code: 2,
        },
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reports options it does not take", async () => {
    using p = project();
    const handlers = createContentMapperHandlers(evaluateConfigInProcess);
    await handlers.initialize({ positionEncodings: ["utf-16"] });

    expect((await open(handlers, p.tsconfig, { temporal: true })).optionDiagnostics).toEqual([
      {
        path: ["temporal"],
        messageText:
          "@tailor-platform/sdk's content mapper takes no options; it reads tailor.config.ts",
        code: 3,
      },
    ]);
  });
});

describe("initialize", () => {
  test("negotiates UTF-16 positions when offered", async () => {
    expect(
      await createContentMapperHandlers(evaluateConfigInProcess).initialize({
        positionEncodings: ["utf-8", "utf-16"],
        protocolVersion: 1,
      }),
    ).toEqual({ protocolVersion: 1, positionEncoding: "utf-16", diagnosticSource: "tailor" });
  });

  test("negotiates UTF-8 positions when UTF-16 is not offered", async () => {
    using p = project();
    const handlers = createContentMapperHandlers(evaluateConfigInProcess);
    expect(await handlers.initialize({ positionEncodings: ["utf-8"] })).toMatchObject({
      positionEncoding: "utf-8",
    });
    await open(handlers, p.tsconfig);

    const result = await transform(handlers, "café ✓", REGISTRY_FILE);

    expect(result.mappings[0]![3]).toBe(Buffer.byteLength("café ✓"));
  });
});
