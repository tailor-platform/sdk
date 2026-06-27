import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, describe, expect, test } from "vitest";
import { allCodemods } from "./registry";
import { runCodemods } from "./runner";

const CODEMODS_DIR = path.resolve(__dirname, "../codemods");

const principalUnify = allCodemods.find((codemod) => codemod.id === "v2/principal-unify");

if (!principalUnify?.scriptPath) {
  throw new Error("v2/principal-unify codemod is not registered with a script");
}

const principalUnifyEntry = {
  codemod: principalUnify,
  scriptPath: path.join(CODEMODS_DIR, principalUnify.scriptPath.replace(/\.js$/, ".ts")),
};

describe("principal-unify review findings", () => {
  let tmpDir: string | undefined;

  afterEach(async () => {
    if (tmpDir) {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  async function writeProjectFile(relative: string, source: string): Promise<void> {
    tmpDir ??= await fs.promises.mkdtemp(path.join(os.tmpdir(), "principal-review-test-"));
    const file = path.join(tmpDir, relative);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, source, "utf-8");
  }

  test("reports nullable caller values passed to non-null-looking calls", async () => {
    await writeProjectFile(
      "resolvers/order.ts",
      [
        'import { createResolver } from "@tailor-platform/sdk";',
        "",
        "declare const db: any;",
        "declare function publishAudit(userId: string): Promise<void>;",
        "",
        "export const resolver = createResolver({",
        "  body: async (context) => {",
        '    await db.selectFrom("orders").where("createdBy", "=", context.user.id).execute();',
        "    await publishAudit(context.user.id);",
        "    const maybeId = context.user.id;",
        "    return maybeId;",
        "  },",
        "});",
        "",
      ].join("\n"),
    );

    const result = await runCodemods([principalUnifyEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/principal-unify",
        files: ["resolvers/order.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/order.ts",
            line: 8,
            message: expect.stringContaining("Kysely predicate"),
            excerpt: expect.stringContaining("context.caller?.id"),
          }),
          expect.objectContaining({
            file: "resolvers/order.ts",
            line: 9,
            message: expect.stringContaining("non-null argument"),
            excerpt: expect.stringContaining("publishAudit(context.caller?.id)"),
          }),
        ],
      }),
    ]);
  });

  test("reports context.user helper adapters called with resolver contexts", async () => {
    await writeProjectFile(
      "resolvers/customer.ts",
      [
        'import { createResolver } from "@tailor-platform/sdk";',
        "",
        "function createContext(context: any) {",
        "  return {",
        "    userId: context.user.id,",
        "    userType: context.user.type,",
        "  };",
        "}",
        "",
        "export const resolver = createResolver({",
        "  body: async (context) => createContext(context),",
        "});",
        "",
      ].join("\n"),
    );

    const result = await runCodemods([principalUnifyEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/principal-unify",
        files: ["resolvers/customer.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/customer.ts",
            line: 3,
            message: expect.stringContaining("createContext"),
            excerpt: expect.stringContaining("function createContext"),
          }),
          expect.objectContaining({
            file: "resolvers/customer.ts",
            line: 11,
            message: expect.stringContaining("createContext"),
            excerpt: expect.stringContaining("createContext(context)"),
          }),
        ],
      }),
    ]);
  });

  test("reports helper adapters that destructure context.user", async () => {
    await writeProjectFile(
      "resolvers/destructured-helper.ts",
      [
        'import { createResolver } from "@tailor-platform/sdk";',
        "",
        "function createContext(context: any) {",
        "  const { user } = context;",
        "  return { userId: user.id };",
        "}",
        "",
        "export const resolver = createResolver({",
        "  body: async (context) => createContext(context),",
        "});",
        "",
      ].join("\n"),
    );

    const result = await runCodemods([principalUnifyEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/principal-unify",
        files: ["resolvers/destructured-helper.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/destructured-helper.ts",
            line: 3,
            message: expect.stringContaining("createContext"),
          }),
          expect.objectContaining({
            file: "resolvers/destructured-helper.ts",
            line: 9,
            message: expect.stringContaining("createContext"),
          }),
        ],
      }),
    ]);
  });

  test("reports helper adapters with destructured context parameters", async () => {
    await writeProjectFile(
      "resolvers/destructured-param-helper.ts",
      [
        'import { createResolver } from "@tailor-platform/sdk";',
        "",
        "function createContext({ user }: any) {",
        "  return { userId: user.id };",
        "}",
        "",
        "export const resolver = createResolver({",
        "  body: async (context) => createContext(context),",
        "});",
        "",
      ].join("\n"),
    );

    const result = await runCodemods([principalUnifyEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/principal-unify",
        files: ["resolvers/destructured-param-helper.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/destructured-param-helper.ts",
            line: 3,
            message: expect.stringContaining("createContext"),
          }),
          expect.objectContaining({
            file: "resolvers/destructured-param-helper.ts",
            line: 8,
            message: expect.stringContaining("createContext"),
          }),
        ],
      }),
    ]);
  });

  test("keeps file-level suspicious-pattern fallback without precise findings", async () => {
    await writeProjectFile(
      "resolvers/context-type.ts",
      [
        'import type { ResolverContext } from "@tailor-platform/sdk";',
        "",
        "export type AdapterContext = ResolverContext;",
        "",
      ].join("\n"),
    );

    const result = await runCodemods([principalUnifyEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/principal-unify",
        files: ["resolvers/context-type.ts"],
      }),
    ]);
    expect(result.llmReviews[0]).not.toHaveProperty("findings");
  });

  test("reports nullable aliased caller values passed to non-null-looking calls", async () => {
    await writeProjectFile(
      "resolvers/aliased.ts",
      [
        'import { createResolver } from "@tailor-platform/sdk";',
        "",
        "declare function publishAudit(userId: string): Promise<void>;",
        "",
        "export const resolver = createResolver({",
        "  body: async ({ user: currentUser }) => {",
        "    await publishAudit(currentUser.id);",
        "  },",
        "});",
        "",
      ].join("\n"),
    );

    const result = await runCodemods([principalUnifyEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/principal-unify",
        files: ["resolvers/aliased.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/aliased.ts",
            line: 7,
            message: expect.stringContaining("non-null argument"),
            excerpt: expect.stringContaining("publishAudit(currentUser?.id)"),
          }),
        ],
      }),
    ]);
  });

  test("reports nullable caller objects passed directly to non-null-looking calls", async () => {
    await writeProjectFile(
      "resolvers/direct-caller.ts",
      [
        'import { createResolver } from "@tailor-platform/sdk";',
        "",
        "declare function publishAudit(user: { id: string }): Promise<void>;",
        "",
        "export const contextResolver = createResolver({",
        "  body: async (context) => {",
        "    await publishAudit(context.user);",
        "  },",
        "});",
        "",
        "export const destructuredResolver = createResolver({",
        "  body: async ({ user }) => {",
        "    await publishAudit(user);",
        "  },",
        "});",
        "",
      ].join("\n"),
    );

    const result = await runCodemods([principalUnifyEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/principal-unify",
        files: ["resolvers/direct-caller.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/direct-caller.ts",
            line: 7,
            message: expect.stringContaining("non-null argument"),
            excerpt: expect.stringContaining("publishAudit(context.caller)"),
          }),
          expect.objectContaining({
            file: "resolvers/direct-caller.ts",
            line: 13,
            message: expect.stringContaining("non-null argument"),
            excerpt: expect.stringContaining("publishAudit(caller)"),
          }),
        ],
      }),
    ]);
  });

  test("reports aliases assigned from nullable caller values", async () => {
    await writeProjectFile(
      "resolvers/assigned-alias.ts",
      [
        'import { createResolver } from "@tailor-platform/sdk";',
        "",
        "declare function publishAudit(userId: string): Promise<void>;",
        "",
        "export const resolver = createResolver({",
        "  body: async (context) => {",
        "    const user = context.user;",
        "    await publishAudit(user.id);",
        "  },",
        "});",
        "",
      ].join("\n"),
    );

    const result = await runCodemods([principalUnifyEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/principal-unify",
        files: ["resolvers/assigned-alias.ts"],
        findings: [
          expect.objectContaining({
            file: "resolvers/assigned-alias.ts",
            line: 8,
            message: expect.stringContaining("non-null argument"),
            excerpt: expect.stringContaining("publishAudit(user.id)"),
          }),
        ],
      }),
    ]);
  });

  test("does not report unrelated caller properties as nullable principals", async () => {
    await writeProjectFile(
      "resolvers/domain-caller.ts",
      [
        'import { createResolver } from "@tailor-platform/sdk";',
        "",
        "declare function publishAudit(userId: string): Promise<void>;",
        "",
        "export const resolver = createResolver({",
        "  body: async ({ user }) => {",
        "    const event = { caller: { id: user.id } };",
        "    await publishAudit(event.caller.id);",
        "  },",
        "});",
        "",
      ].join("\n"),
    );

    const result = await runCodemods([principalUnifyEntry], tmpDir!, false);

    expect(result.llmReviews.flatMap((review) => review.findings ?? [])).toEqual([]);
  });

  test("does not report matching alias names outside the resolver scope", async () => {
    await writeProjectFile(
      "resolvers/scoped-alias.ts",
      [
        'import { createResolver } from "@tailor-platform/sdk";',
        "",
        "declare function publishAudit(userId: string | undefined): Promise<void>;",
        "",
        "export const resolver = createResolver({",
        "  body: async ({ user: currentUser }) => currentUser.id,",
        "});",
        "",
        "async function audit(currentUser?: { id: string }) {",
        "  await publishAudit(currentUser?.id);",
        "}",
        "",
      ].join("\n"),
    );

    const result = await runCodemods([principalUnifyEntry], tmpDir!, false);

    expect(result.llmReviews).toEqual([]);
  });
});
