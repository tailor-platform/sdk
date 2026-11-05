import * as fs from "node:fs";
import * as path from "pathe";
import { describe, expect, test } from "vitest";
import { silenceLogger } from "#/cli/shared/test-helpers/silence-logger";
import { makeTempDir } from "#/cli/shared/test-helpers/temp-dir";
import { createContentMapperHandlers } from "./mapper";

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
  test("types registry.tailor with the registries of the project's tailor.config.ts", async () => {
    using p = project();
    const handlers = createContentMapperHandlers();
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
    const handlers = createContentMapperHandlers();
    await handlers.initialize({ positionEncodings: ["utf-16"] });
    await open(handlers, p.tsconfig);

    const result = await transform(handlers, "", "/other.tailor");

    expect(result.text).toBe("export {};\n");
    expect(result.diagnostics).toEqual([]);
  });

  test("changes its identity and types when the config changes", async () => {
    using p = project();
    const handlers = createContentMapperHandlers();
    await handlers.initialize({ positionEncodings: ["utf-16"] });
    const before = await open(handlers, p.tsconfig);

    fs.writeFileSync(p.config, CONFIG.replace('stage: "dev"', 'stage: "dev", region: "tokyo"'));
    const after = await open(handlers, p.tsconfig);

    expect(after.configIdentity).not.toBe(before.configIdentity);
    expect((await transform(handlers, "", REGISTRY_FILE)).text).toContain("region: string;");
  });

  test("reports a config that fails to load on the file and keeps watching it", async () => {
    using p = project();
    const handlers = createContentMapperHandlers();
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
    const handlers = createContentMapperHandlers();
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
      const handlers = createContentMapperHandlers();
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
    const handlers = createContentMapperHandlers();
    await handlers.initialize({ positionEncodings: ["utf-16"] });

    expect((await open(handlers, p.tsconfig, { temporal: true })).optionDiagnostics).toEqual([
      {
        path: ["temporal"],
        messageText:
          "@tailor-platform/sdk's content mapper takes only the config option, the path of tailor.config.ts",
        code: 3,
      },
    ]);
  });

  test("reports a config option that is not a path", async () => {
    using p = project();
    const handlers = createContentMapperHandlers();
    await handlers.initialize({ positionEncodings: ["utf-16"] });

    expect((await open(handlers, p.tsconfig, { config: true })).optionDiagnostics).toEqual([
      { path: ["config"], messageText: "config must be the path of tailor.config.ts", code: 3 },
    ]);
  });
});

const ORDER_TABLE = `
import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";
export const order = db
  .table("Order", { status: db.enum(["PAID", "OPEN"]), amount: db.int() })
  .permission(unsafeAllowAllTypePermission)
  .gqlPermission(unsafeAllowAllGqlPermission);
`;

const PING_RESOLVER = `
import { createResolver, t } from "@tailor-platform/sdk";
export default createResolver({
  name: "ping",
  operation: "query",
  permission: "allowAnonymous",
  input: { message: t.string() },
  body: ({ input }) => input.message,
  output: t.string(),
});
`;

const CLIENT_CONFIG = `import { defineConfig } from "@tailor-platform/sdk";
export default defineConfig({
  name: "app",
  env: { stage: "dev" },
  db: { main: { files: ["./tailordb/*.ts"] } },
  resolver: { main: { files: ["./resolvers/*.ts"] } },
});
`;

function writeClientProject(dir: string, resolverName = "ping") {
  fs.mkdirSync(path.join(dir, "tailordb"), { recursive: true });
  fs.mkdirSync(path.join(dir, "resolvers"), { recursive: true });
  fs.writeFileSync(path.join(dir, "tailor.config.ts"), CLIENT_CONFIG);
  fs.writeFileSync(path.join(dir, "tailordb", "order.ts"), ORDER_TABLE);
  fs.writeFileSync(
    path.join(dir, "resolvers", `${resolverName}.ts`),
    PING_RESOLVER.replace('name: "ping"', `name: "${resolverName}"`),
  );
}

function clientProject(): ReturnType<typeof project> & { table: string; resolver: string } {
  const p = project();
  writeClientProject(p.dir);
  return Object.assign(p, {
    table: path.join(p.dir, "tailordb", "order.ts"),
    resolver: path.join(p.dir, "resolvers", "ping.ts"),
  });
}

describe("resolvers.tailor and tailordb.tailor", () => {
  async function start(tsconfig: string, options?: unknown) {
    const handlers = createContentMapperHandlers();
    await handlers.initialize({ positionEncodings: ["utf-16"] });
    const opened = await open(handlers, tsconfig, options);
    return { handlers, opened };
  }

  test("types resolvers.tailor with a function for each resolver, derived from its definition file", async () => {
    using p = clientProject();
    const { handlers } = await start(p.tsconfig);

    const result = await transform(handlers, "", "/resolvers.tailor");

    expect(result.diagnostics).toEqual([]);
    expect(result.text).toContain(
      `import type definition0 from ${JSON.stringify(p.resolver.replace(/\.ts$/, ""))};`,
    );
    expect(result.text).toContain("declare const resolver0: ResolverFunction<typeof definition0>;");
    expect(result.text).toContain('export { resolver0 as "ping" };');
  });

  test("types tailordb.tailor with the record operations of each table, derived from its definition", async () => {
    using p = clientProject();
    const { handlers } = await start(p.tsconfig);

    const result = await transform(handlers, "", "/tailordb.tailor");

    expect(result.diagnostics).toEqual([]);
    expect(result.text).toContain(
      `import type { order as definition0 } from ${JSON.stringify(p.table.replace(/\.ts$/, ""))};`,
    );
    expect(result.text).toContain('export { crud0 as "Order" };');
  });

  test("watches the files that define the resolvers and tables", async () => {
    using p = clientProject();
    const { opened } = await start(p.tsconfig);

    expect(opened.watchedFiles).toEqual(expect.arrayContaining([p.config, p.table, p.resolver]));
  });

  test("changes its identity when a resolver is renamed", async () => {
    using p = clientProject();
    const { handlers, opened: before } = await start(p.tsconfig);

    fs.writeFileSync(p.resolver, PING_RESOLVER.replace('name: "ping"', 'name: "pong"'));
    const after = await open(handlers, p.tsconfig);

    expect(after.configIdentity).not.toBe(before.configIdentity);
    expect(await transform(handlers, "", "/resolvers.tailor")).toMatchObject({
      text: expect.stringContaining('"pong"'),
    });
  });

  test("keeps typing registry.tailor when a resolver definition fails to load, and reports it on resolvers.tailor", async () => {
    using p = clientProject();
    fs.writeFileSync(p.resolver, "throw new Error('broken resolver');");
    using _logger = silenceLogger("error");
    const { handlers } = await start(p.tsconfig);

    const registry = await transform(handlers, "", REGISTRY_FILE);
    const resolvers = await transform(handlers, "", "/resolvers.tailor");

    expect(registry.diagnostics).toEqual([]);
    expect(registry.text).toContain("stage: string;");
    expect(resolvers.diagnostics).toHaveLength(1);
    expect(resolvers.diagnostics[0]?.messageText).toContain("broken resolver");
  });

  describe("choosing the config", () => {
    function nested(dir: string, resolverName: string) {
      const root = path.join(dir, "nested");
      writeClientProject(root, resolverName);
      return root;
    }

    const typed = async (handlers: Handlers, fileName: string) =>
      (await transform(handlers, "", fileName)).text;

    test("uses the config nearest to the file rather than the one found from the tsconfig", async () => {
      using p = clientProject();
      const root = nested(p.dir, "pong");
      const { handlers } = await start(p.tsconfig);

      const text = await typed(handlers, path.join(root, "resolvers.tailor"));

      expect(text).toContain('export { resolver0 as "pong" };');
      expect(text).not.toContain('"ping"');
    });

    test("types a file from the config near it even when the tsconfig has no config above it", async () => {
      using p = clientProject();
      const app = makeTempDir("sdk-content-mapper-app-");
      try {
        const { handlers } = await start(path.join(app, "tsconfig.json"));

        expect(await typed(handlers, path.join(p.dir, "resolvers.tailor"))).toContain('"ping"');
      } finally {
        fs.rmSync(app, { recursive: true, force: true });
      }
    });

    test("uses the config named by the config option for every file, even one near another config", async () => {
      using p = clientProject();
      const root = nested(p.dir, "pong");
      const app = makeTempDir("sdk-content-mapper-app-");
      try {
        const { handlers, opened } = await start(path.join(app, "tsconfig.json"), {
          config: path.relative(app, p.config),
        });

        expect(opened.optionDiagnostics).toEqual([]);
        expect(opened.watchedFiles).toEqual(expect.arrayContaining([p.config, p.resolver]));
        expect(await typed(handlers, path.join(root, "resolvers.tailor"))).toContain('"ping"');
        expect(await typed(handlers, path.join(app, "resolvers.tailor"))).toContain('"ping"');
      } finally {
        fs.rmSync(app, { recursive: true, force: true });
      }
    });

    test("reports a config option that names no file, and watches for it", async () => {
      const dir = makeTempDir("sdk-content-mapper-missing-");
      try {
        const missing = path.join(dir, "backend", "tailor.config.ts");
        const { handlers, opened } = await start(path.join(dir, "tsconfig.json"), {
          config: "./backend/tailor.config.ts",
        });
        const result = await transform(handlers, "", path.join(dir, "resolvers.tailor"));

        expect(opened.watchedFiles).toEqual([missing]);
        expect(result.diagnostics.map((diagnostic) => diagnostic.messageText)).toEqual([
          `No config found at ${missing}`,
        ]);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    test("reports a failure to load the config near a file on that file only", async () => {
      using p = clientProject();
      const root = nested(p.dir, "pong");
      fs.writeFileSync(
        path.join(root, "resolvers", "pong.ts"),
        "throw new Error('broken nested');",
      );
      using _logger = silenceLogger("error");
      const { handlers } = await start(p.tsconfig);

      const nearby = await transform(handlers, "", path.join(root, "resolvers.tailor"));
      const own = await transform(handlers, "", path.join(p.dir, "resolvers.tailor"));

      expect(nearby.diagnostics).toHaveLength(1);
      expect(nearby.diagnostics[0]?.messageText).toContain("broken nested");
      expect(own.diagnostics).toEqual([]);
    });
  });
});

describe("initialize", () => {
  test("negotiates UTF-16 positions when offered", async () => {
    expect(
      await createContentMapperHandlers().initialize({
        positionEncodings: ["utf-8", "utf-16"],
        protocolVersion: 1,
      }),
    ).toEqual({ protocolVersion: 1, positionEncoding: "utf-16", diagnosticSource: "tailor" });
  });

  test("negotiates UTF-8 positions when UTF-16 is not offered", async () => {
    using p = project();
    const handlers = createContentMapperHandlers();
    expect(await handlers.initialize({ positionEncodings: ["utf-8"] })).toMatchObject({
      positionEncoding: "utf-8",
    });
    await open(handlers, p.tsconfig);

    const result = await transform(handlers, "café ✓", REGISTRY_FILE);

    expect(result.mappings[0]![3]).toBe(Buffer.byteLength("café ✓"));
  });
});
