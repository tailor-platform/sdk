import * as fs from "node:fs";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { silenceLogger } from "#/cli/shared/test-helpers/silence-logger";
import {
  brandedDefault,
  WORKSPACE_DB_SOURCE,
  writeWorkspaceTables,
} from "#/cli/shared/test-helpers/workspace-config";
import { generate } from "./service";

const TABLE = (name: string) =>
  `import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";
export const table = db
  .table(${JSON.stringify(name)}, { email: db.string().unique() })
  .permission(unsafeAllowAllTypePermission)
  .gqlPermission(unsafeAllowAllGqlPermission);
`;

// Records what the TailorDB-ready hook receives, and what reading `auth` gives or throws.
const RECORDING_PLUGIN = `{
  id: "record",
  description: "Records the TailorDB-ready context",
  onTailorDBReady: (ctx) => {
    let auth;
    try {
      auth = ctx.auth?.name ?? null;
    } catch (error) {
      auth = { code: error.code, suggestion: error.suggestion };
    }
    const record = {
      namespaces: ctx.tailordb.map((namespace) => namespace.namespace),
      configPath: ctx.configPath,
      auths: Object.keys(ctx.auths),
      auth,
    };
    return { files: [{ path: "./generated/ready.json", content: JSON.stringify(record) }] };
  },
}`;

const AUTH = (name: string) =>
  `${JSON.stringify(name)}: defineAuth(${JSON.stringify(name)}, { machineUserAttributes: {}, machineUsers: {} })`;

function workspaceConfig(auths: string[]): string {
  return `import { defineAuth, definePlugins } from "@tailor-platform/sdk";
import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";
${brandedDefault(
  "workspace-config",
  `{
  db: ${WORKSPACE_DB_SOURCE},
  auth: { ${auths.map(AUTH).join(", ")} },
  apps: { shop: { db: ["customer-db", "order-db"] } },
}`,
)}
export const plugins = definePlugins(
  kyselyTypePlugin({ distPath: "./generated/db.ts" }),
  ${RECORDING_PLUGIN},
);
`;
}

describe("generate with a workspace config", () => {
  let dir: string;
  let configPath: string;
  const originalCwd = process.cwd();

  beforeEach(() => {
    // Inside the package, so the project's `@tailor-platform/sdk` imports resolve to its build.
    dir = fs.realpathSync(fs.mkdtempSync(path.join(import.meta.dirname, ".workspace-generate-")));
    configPath = path.join(dir, "tailor.config.ts");
    writeWorkspaceTables(dir, TABLE);
    process.chdir(dir);
    vi.stubEnv("TAILOR_BUILD_OUTPUT_DIR", path.join(dir, ".tailor"));
    silenceLogger("log", "info", "success", "warn", "newline", "debug");
  });

  afterEach(() => {
    process.chdir(originalCwd);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function readJson(file: string): unknown {
    return JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
  }

  test("writes the Kysely types of every namespace, including one no application lists", async () => {
    fs.writeFileSync(configPath, workspaceConfig(["corp-auth"]));

    await generate({ configPath });

    const types = fs.readFileSync(path.join(dir, "generated", "db.ts"), "utf8");
    expect(types).toContain('"customer-db": {');
    expect(types).toContain('"order-db": {');
    expect(types).toContain('"ledger-db": {');
    expect(readJson("generated/ready.json")).toMatchObject({
      namespaces: ["customer-db", "order-db", "ledger-db"],
      configPath,
    });
    expect(fs.readFileSync(path.join(dir, "tailor.d.ts"), "utf8")).toContain('workspace: "unset";');
  });

  test("asks for table names unique across the workspace when two namespaces share one", async () => {
    fs.writeFileSync(path.join(dir, "db", "ledger", "table.ts"), TABLE("Customer"));
    fs.writeFileSync(configPath, workspaceConfig(["corp-auth"]));

    await expect(generate({ configPath })).rejects.toMatchObject({
      suggestion:
        "Give each TailorDB type a name that is unique across all TailorDB namespaces in the workspace.",
    });
  });

  test("passes plugins the only Auth service as auth, and every Auth service as auths", async () => {
    fs.writeFileSync(configPath, workspaceConfig(["corp-auth"]));

    await generate({ configPath });

    expect(readJson("generated/ready.json")).toMatchObject({
      auths: ["corp-auth"],
      auth: "corp-auth",
    });
  });

  test("points plugins that read auth to auths when the workspace has several Auth services", async () => {
    fs.writeFileSync(configPath, workspaceConfig(["corp-auth", "partner-auth"]));

    await generate({ configPath });

    expect(readJson("generated/ready.json")).toMatchObject({
      auths: ["corp-auth", "partner-auth"],
      auth: {
        code: "PLUGIN_CONTEXT_FIELD_AMBIGUOUS",
        suggestion: 'Change the code that reads "auth" to read "auths".',
      },
    });
  });
});
