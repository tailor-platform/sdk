import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "pathe";
import { afterEach, describe, expect, test } from "vitest";

const mapperEntry = fileURLToPath(
  new URL("../../../dist/cli/content-mapper/mapper-main.mjs", import.meta.url),
);
const REGISTRY_FILE = "/node_modules/@tailor-platform/sdk/dist/configure/registry.tailor";
const CONFIG = `import { defineConfig } from "@tailor-platform/sdk";
export default defineConfig({ name: "app", env: { stage: "dev" } });
`;
const TIMEOUT_MS = 60_000;

interface MapperProcess {
  call(method: string, params: unknown): Promise<Record<string, unknown>>;
  child: ChildProcess;
}

const started: ChildProcess[] = [];
const projects: string[] = [];

afterEach(() => {
  for (const child of started.splice(0)) child.kill();
  for (const dir of projects.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function startMapper(): MapperProcess {
  const child = spawn(process.execPath, [mapperEntry], { stdio: ["pipe", "pipe", "ignore"] });
  started.push(child);
  let buffer = Buffer.alloc(0);
  const waiting = new Map<number, (result: Record<string, unknown>) => void>();
  let id = 0;
  child.stdout.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const length = Number(
        /Content-Length:\s*(\d+)/i.exec(buffer.subarray(0, headerEnd).toString())![1],
      );
      if (buffer.length < headerEnd + 4 + length) return;
      const message = JSON.parse(buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString());
      buffer = buffer.subarray(headerEnd + 4 + length);
      waiting.get(message.id)?.(message.result);
    }
  });
  return {
    child,
    call: (method, params) =>
      new Promise((resolve) => {
        const requestId = ++id;
        waiting.set(requestId, resolve);
        const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }));
        child.stdin.write(
          Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]),
        );
      }),
  };
}

function projectDir(): string {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(import.meta.dirname, ".sdk-content-mapper-process-")),
  );
  projects.push(dir);
  fs.writeFileSync(path.join(dir, "tsconfig.json"), "{}");
  return dir;
}

async function open(mapper: MapperProcess, dir: string) {
  await mapper.call("initialize", { positionEncodings: ["utf-16"], protocolVersion: 1 });
  return mapper.call("openProject", {
    configFileName: path.join(dir, "tsconfig.json"),
    projectHandle: "p1",
    compilerOptions: {},
  }) as Promise<{ watchedFiles: string[] }>;
}

describe("content mapper process", () => {
  test(
    "types registry.tailor from the project's config once initialized and opened",
    async () => {
      const dir = projectDir();
      fs.writeFileSync(path.join(dir, "tailor.config.ts"), CONFIG);
      const mapper = startMapper();

      const opened = await open(mapper, dir);
      const result = (await mapper.call("transform", {
        fileName: REGISTRY_FILE,
        content: "",
        projectHandle: "p1",
      })) as { text: string; diagnostics: unknown[] };

      expect(opened.watchedFiles).toContain(path.join(dir, "tailor.config.ts"));
      expect(result.diagnostics).toEqual([]);
      expect(result.text).toContain("stage: string;");
    },
    TIMEOUT_MS,
  );

  test(
    "keeps watching the files a failing config imported, so fixing one reloads the project",
    async () => {
      const dir = projectDir();
      const helper = path.join(dir, "helper.ts");
      fs.writeFileSync(helper, 'throw new Error("boom");\n');
      fs.writeFileSync(path.join(dir, "tailor.config.ts"), `import "./helper";\n${CONFIG}`);
      const mapper = startMapper();

      const opened = await open(mapper, dir);
      const result = (await mapper.call("transform", {
        fileName: REGISTRY_FILE,
        content: "",
        projectHandle: "p1",
      })) as { diagnostics: { messageText: string }[] };

      expect(opened.watchedFiles).toEqual(
        expect.arrayContaining([path.join(dir, "tailor.config.ts"), helper]),
      );
      expect(result.diagnostics.map((d) => d.messageText)).toEqual(["boom"]);
    },
    TIMEOUT_MS,
  );

  test(
    "watches where an import that does not exist yet would be created, so creating it reloads the project",
    async () => {
      const dir = projectDir();
      fs.writeFileSync(path.join(dir, "tailor.config.ts"), `import "./helper";\n${CONFIG}`);
      const mapper = startMapper();

      const opened = await open(mapper, dir);
      expect(opened.watchedFiles).toContain(path.join(dir, "helper.ts"));

      fs.writeFileSync(path.join(dir, "helper.ts"), "export {};\n");
      await mapper.call("openProject", {
        configFileName: path.join(dir, "tsconfig.json"),
        projectHandle: "p1",
        compilerOptions: {},
      });
      const result = (await mapper.call("transform", {
        fileName: REGISTRY_FILE,
        content: "",
        projectHandle: "p1",
      })) as { diagnostics: unknown[]; text: string };

      expect(result.diagnostics).toEqual([]);
      expect(result.text).toContain("stage: string;");
    },
    TIMEOUT_MS,
  );

  test.each([
    { specifier: "./helper.js", created: ["helper.ts"] },
    { specifier: "./helper.mjs", created: ["helper.mts"] },
    {
      specifier: "./user.model",
      created: ["user.model.ts", "user.model.mts", "user.model/index.ts"],
    },
  ])(
    "watches the TypeScript files the import resolver would find for $specifier",
    async ({ specifier, created }) => {
      const dir = projectDir();
      fs.writeFileSync(path.join(dir, "tailor.config.ts"), `import "${specifier}";\n${CONFIG}`);
      const mapper = startMapper();

      const opened = await open(mapper, dir);

      expect(opened.watchedFiles).toEqual(
        expect.arrayContaining(created.map((file) => path.join(dir, file))),
      );
    },
    TIMEOUT_MS,
  );

  test.each([
    {
      name: "a tsconfig paths alias",
      files: {
        "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
      },
      specifier: "@/stages",
      created: ["src/stages.ts", "src/stages.mts", "src/stages/index.ts"],
    },
    {
      name: "a tsconfig paths alias in a tsconfig with comments and trailing commas",
      files: {
        "tsconfig.json": `{
  // aliases
  "compilerOptions": { "paths": { "@/*": ["./src/*"], }, },
}`,
      },
      specifier: "@/stages",
      created: ["src/stages.ts", "src/stages.mts", "src/stages/index.ts"],
    },
    {
      name: "a tsconfig paths alias inherited through extends",
      files: {
        "tsconfig.json": JSON.stringify({ extends: "./tsconfig.base.json" }),
        "tsconfig.base.json": JSON.stringify({
          compilerOptions: { paths: { "@/*": ["./lib/*"] } },
        }),
      },
      specifier: "@/stages",
      created: ["lib/stages.ts", "lib/stages.mts", "lib/stages/index.ts"],
    },
    {
      name: "a package.json imports pattern",
      files: { "package.json": JSON.stringify({ imports: { "#app/*": "./src/*" } }) },
      specifier: "#app/stages",
      created: ["src/stages.ts", "src/stages.mts", "src/stages/index.ts"],
    },
    {
      name: "a package.json imports pattern with conditions",
      files: {
        "package.json": JSON.stringify({
          imports: { "#app/*.js": { import: "./src/*.ts", default: "./lib/*.js" } },
        }),
      },
      specifier: "#app/stages.js",
      created: ["src/stages.ts", "lib/stages.js"],
    },
    {
      name: "an exact package.json imports key",
      files: { "package.json": JSON.stringify({ imports: { "#stages": "./src/stages.ts" } }) },
      specifier: "#stages",
      created: ["src/stages.ts"],
    },
  ])(
    "watches where $name would find a file that does not exist yet",
    async ({ files, specifier, created }) => {
      const dir = projectDir();
      for (const [name, content] of Object.entries(files)) {
        fs.writeFileSync(path.join(dir, name), content);
      }
      fs.writeFileSync(path.join(dir, "tailor.config.ts"), `import "${specifier}";\n${CONFIG}`);
      const mapper = startMapper();

      const opened = await open(mapper, dir);

      expect(opened.watchedFiles).toEqual(
        expect.arrayContaining(created.map((file) => path.join(dir, file))),
      );
    },
    TIMEOUT_MS,
  );

  test(
    "types the config from a workspace package's current contents each time the project is opened",
    async () => {
      const dir = projectDir();
      const shared = path.join(dir, "node_modules", "@acme", "shared");
      fs.mkdirSync(shared, { recursive: true });
      fs.writeFileSync(
        path.join(shared, "package.json"),
        JSON.stringify({ name: "@acme/shared", type: "module", exports: "./index.js" }),
      );
      fs.writeFileSync(path.join(shared, "index.js"), 'export const stage = "dev";\n');
      fs.writeFileSync(
        path.join(dir, "tailor.config.ts"),
        `import { defineConfig } from "@tailor-platform/sdk";
import { stage } from "@acme/shared";
export default defineConfig({ name: "app", env: { stage } });
`,
      );
      fs.mkdirSync(path.join(dir, "node_modules", "@tailor-platform"), { recursive: true });
      fs.symlinkSync(
        fileURLToPath(new URL("../../..", import.meta.url)),
        path.join(dir, "node_modules", "@tailor-platform", "sdk"),
      );
      const mapper = startMapper();
      const typesOf = async () => {
        await open(mapper, dir);
        const result = (await mapper.call("transform", {
          fileName: REGISTRY_FILE,
          content: "",
          projectHandle: "p1",
        })) as { text: string };
        return result.text.match(/stage: [^;]+;/)?.[0];
      };

      expect(await typesOf()).toBe("stage: string;");
      fs.writeFileSync(path.join(shared, "index.js"), "export const stage = 42;\n");
      expect(await typesOf()).toBe("stage: number;");
    },
    TIMEOUT_MS,
  );
});
