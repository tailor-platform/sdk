import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { safeqlPlugin, type SafeqlPluginOptions } from "./plugin";

type Hook = NonNullable<ReturnType<typeof safeqlPlugin>["onTailorDBReady"]>;
type Context = Parameters<Hook>[0];

function namespace(name: string, tables: Record<string, unknown>) {
  return { namespace: name, tables };
}

const account = {
  name: "Account",
  fields: {
    id: { config: { type: "uuid", required: true } },
    email: { config: { type: "string", required: true } },
    role: {
      config: {
        type: "enum",
        required: true,
        allowedValues: [{ value: "ADMIN" }, { value: "MEMBER" }],
      },
    },
  },
};

async function generate(
  namespaces: ReturnType<typeof namespace>[],
  options: SafeqlPluginOptions = {},
) {
  const plugin = safeqlPlugin(options);
  const context = { tailordb: namespaces, pluginConfig: options } as unknown as Context;
  return plugin.onTailorDBReady!(context);
}

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "safeql-plugin-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function inDirectory(options: SafeqlPluginOptions = {}): SafeqlPluginOptions {
  return {
    distPath: join(directory, "generated/safeql/eslint.ts"),
    eslintConfigPath: join(directory, "eslint.config.ts"),
    ...options,
  };
}

describe("safeqlPlugin", () => {
  test("writes an ESLint config module that embeds the schema and the enum column types", async () => {
    const { files } = await generate([namespace("main", { Account: account })], inDirectory());
    const module = files.find((file) => file.path.endsWith("generated/safeql/eslint.ts"));
    expect(module?.content).toContain(
      'import { tailorSafeqlConfig } from "@tailor-platform/sdk-plugin-safeql/eslint";',
    );
    expect(module?.content).toContain('CREATE TABLE IF NOT EXISTS \\"Account\\"');
    expect(module?.content).toContain(`"Account.role": "'ADMIN' | 'MEMBER'"`);
    expect(module?.content).toContain("DO NOT EDIT");
  });

  test("passes the files option through to the generated config", async () => {
    const { files } = await generate(
      [namespace("main", { Account: account })],
      inDirectory({ files: ["resolvers/**/*.ts"] }),
    );
    expect(files[0]?.content).toContain('"resolvers/**/*.ts"');
  });

  test("creates eslint.config.ts importing the generated module only when it does not exist", async () => {
    const { files } = await generate([namespace("main", { Account: account })], inDirectory());
    const config = files.find((file) => file.path.endsWith("eslint.config.ts"));
    expect(config).toMatchObject({
      skipIfExists: true,
      content: expect.stringContaining('import safeql from "./generated/safeql/eslint";'),
    });
    expect(config?.content).toContain("export default [...safeql];");
  });

  test.each(["eslint.config.js", "eslint.config.mjs", "eslint.config.cjs", "eslint.config.mts"])(
    "does not create eslint.config.ts next to an existing %s",
    async (existing) => {
      await writeFile(join(directory, existing), "export default [];\n");
      const { files } = await generate([namespace("main", { Account: account })], inDirectory());
      expect(files.map((file) => file.path)).toEqual([
        join(directory, "generated/safeql/eslint.ts"),
      ]);
    },
  );

  test("uses the only namespace that has tables", async () => {
    const { files } = await generate(
      [namespace("empty", {}), namespace("main", { Account: account })],
      inDirectory(),
    );
    expect(files[0]?.content).toContain("Account");
  });

  test("writes nothing when no namespace has tables", async () => {
    const result = await generate([namespace("empty", {})], inDirectory());
    expect(result.files).toEqual([]);
  });

  test("asks for the namespace option when several namespaces have tables", async () => {
    await expect(
      generate(
        [namespace("a", { Account: account }), namespace("b", { Account: account })],
        inDirectory(),
      ),
    ).rejects.toThrow(/a, b.*namespace option/s);
  });

  test("picks the namespace named by the namespace option", async () => {
    const other = { ...account, name: "Other" };
    const { files } = await generate(
      [namespace("a", { Account: account }), namespace("b", { Other: other })],
      inDirectory({ namespace: "b" }),
    );
    expect(files[0]?.content).toContain("Other");
    expect(files[0]?.content).not.toContain("Account");
  });

  test("rejects a namespace option that names no namespace", async () => {
    await expect(
      generate([namespace("a", { Account: account })], inDirectory({ namespace: "missing" })),
    ).rejects.toThrow(/missing.*a/s);
  });
});
