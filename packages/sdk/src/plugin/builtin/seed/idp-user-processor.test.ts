import { aroundEach, describe, expect, test } from "vitest";
import {
  generateIdpSeedScriptCode,
  generateIdpTruncateScriptCode,
  generateIdpUserSchemaFile,
  processIdpUser,
} from "./idp-user-processor";
import type { GeneratorAuthInput } from "#/plugin/types";

type TruncateResult = { success: boolean; deleted: number; total: number; errors: string[] };

type SeedResult = {
  success: boolean;
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
};

type SeedUser = { name: string; password?: string };

type IdpUserPage = {
  users: Array<{ id: string; name: string }>;
  nextPageToken: string | null;
};

/**
 * Load the `main` function from a generated server-side script string. Uses a
 * data: URL, which the Node.js ESM loader supports, mirroring the deploy
 * integration tests.
 * @param code - Generated script source that exports `main`
 * @returns The exported `main` function
 */
async function loadGeneratedMain(code: string): Promise<() => Promise<TruncateResult>> {
  const url = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  const mod = (await import(/* @vite-ignore */ url)) as { main: () => Promise<TruncateResult> };
  return mod.main;
}

/**
 * Load the `main` function from a generated IdP seed script.
 * @param code - Generated script source that exports `main`
 * @returns The exported `main` function
 */
type SeedInput = { users: SeedUser[]; upsert?: boolean; offset?: number; total?: number };

async function loadSeedMain(code: string): Promise<(input: SeedInput) => Promise<SeedResult>> {
  const url = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  const mod = (await import(/* @vite-ignore */ url)) as {
    main: (input: SeedInput) => Promise<SeedResult>;
  };
  return mod.main;
}

describe("processIdpUser", () => {
  test("returns undefined when idProvider is not BuiltInIdP", () => {
    const auth: GeneratorAuthInput = {
      name: "main-auth",
      machineUsers: { admin: { attributes: { role: "admin" } } },
    };
    expect(processIdpUser(auth)).toBeUndefined();
  });

  test("returns undefined when idProvider is BuiltInIdP but userProfile is missing", () => {
    const auth: GeneratorAuthInput = {
      name: "main-auth",
      idProvider: {
        name: "my-idp",
        kind: "BuiltInIdP",
        namespace: "my-idp",
        clientName: "default",
      },
    };
    expect(processIdpUser(auth)).toBeUndefined();
  });

  test("returns metadata when idProvider is BuiltInIdP and userProfile is defined", () => {
    const auth: GeneratorAuthInput = {
      name: "main-auth",
      idProvider: {
        name: "my-idp",
        kind: "BuiltInIdP",
        namespace: "my-idp",
        clientName: "default",
      },
      userProfile: {
        tableName: "User",
        namespace: "main-db",
        usernameField: "email",
      },
    };
    const result = processIdpUser(auth);
    expect(result).toEqual({
      name: "_User",
      dependencies: ["User"],
      dataFile: "data/_User.jsonl",
      idpNamespace: "my-idp",
      schema: {
        usernameField: "email",
        userTableName: "User",
      },
    });
  });
});

describe("generateIdpUserSchemaFile", () => {
  const options = { usernameField: "email", userTableName: "User" };

  test("emits the userProfile foreign key by default", () => {
    const output = generateIdpUserSchemaFile(options);
    expect(output).toContain("foreignKeys: [");
    expect(output).toContain('table: "User"');
    expect(output).toContain('column: "email"');
  });

  test("emits the userProfile foreign key when includeUserProfileFK is true", () => {
    const output = generateIdpUserSchemaFile({ ...options, includeUserProfileFK: true });
    expect(output).toContain("foreignKeys: [");
  });

  test("omits the userProfile foreign key when includeUserProfileFK is false", () => {
    const output = generateIdpUserSchemaFile({ ...options, includeUserProfileFK: false });
    expect(output).not.toContain("foreignKeys");
    expect(output).toContain('primaryKey: "name"');
    expect(output).toContain("_user_name_unique_idx");
  });
});

describe("generateIdpSeedScriptCode", () => {
  type IdpCalls = {
    created: SeedUser[];
    updated: Array<{ id: string; password?: string }>;
    lookups: string[];
    operations: string[];
  };

  const stubIdp = (existingByName: Record<string, { id: string }>): IdpCalls => {
    const calls: IdpCalls = { created: [], updated: [], lookups: [], operations: [] };
    (globalThis as { tailor?: unknown }).tailor = {
      idp: {
        Client: class {
          async createUser(input: SeedUser) {
            calls.operations.push(`create:${input.name}`);
            if (existingByName[input.name]) {
              throw new Error(`user already exists: ${input.name}`);
            }
            calls.created.push(input);
            return { id: `new-${input.name}` };
          }
          async userByName(name: string) {
            calls.operations.push(`lookup:${name}`);
            calls.lookups.push(name);
            const found = existingByName[name];
            if (!found) throw new Error(`not found: ${name}`);
            return found;
          }
          async updateUser(input: { id: string; password?: string }) {
            calls.operations.push(`update:${input.id}`);
            calls.updated.push(input);
            return { id: input.id };
          }
        },
      },
    };
    return calls;
  };

  aroundEach(async (runTest) => {
    await runTest();
    delete (globalThis as { tailor?: unknown }).tailor;
  });

  test("creates users and reports failure on duplicates when upsert is disabled", async () => {
    const calls = stubIdp({ existing: { id: "existing-id" } });
    const main = await loadSeedMain(generateIdpSeedScriptCode("test-ns"));

    const result = await main({
      users: [
        { name: "fresh", password: "p1" },
        { name: "existing", password: "p2" },
      ],
    });

    expect(calls.created).toEqual([{ name: "fresh", password: "p1" }]);
    expect(calls.updated).toEqual([]);
    expect(result).toMatchObject({
      success: false,
      processed: 1,
      created: 1,
      updated: 0,
    });
    expect(result.errors).toHaveLength(1);
  });

  test("reports row numbers relative to the chunk offset", async () => {
    stubIdp({ existing: { id: "existing-id" } });
    const main = await loadSeedMain(generateIdpSeedScriptCode("test-ns"));

    const result = await main({
      users: [
        { name: "fresh", password: "p1" },
        { name: "existing", password: "p2" },
      ],
      offset: 25,
      total: 51,
    });

    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain("Row 27 (existing)");
  });

  test("defaults to one-based row numbers when no offset is provided", async () => {
    stubIdp({ existing: { id: "existing-id" } });
    const main = await loadSeedMain(generateIdpSeedScriptCode("test-ns"));

    const result = await main({
      users: [
        { name: "fresh", password: "p1" },
        { name: "existing", password: "p2" },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain("Row 2 (existing)");
  });

  test("looks users up before creating or updating them when upsert is enabled", async () => {
    const calls = stubIdp({ existing: { id: "existing-id" } });
    const main = await loadSeedMain(generateIdpSeedScriptCode("test-ns"));

    const result = await main({
      users: [
        { name: "fresh", password: "p1" },
        { name: "existing", password: "p2" },
      ],
      upsert: true,
    });

    expect(calls.created).toEqual([{ name: "fresh", password: "p1" }]);
    expect(calls.updated).toEqual([{ id: "existing-id", password: "p2" }]);
    expect(calls.operations).toEqual([
      "lookup:fresh",
      "create:fresh",
      "lookup:existing",
      "update:existing-id",
    ]);
    expect(result).toMatchObject({
      success: true,
      processed: 2,
      created: 1,
      updated: 1,
      errors: [],
    });
  });

  test("skips an existing user whose seed row has no attributes beyond name", async () => {
    const calls = stubIdp({ existing: { id: "existing-id" } });
    const main = await loadSeedMain(generateIdpSeedScriptCode("test-ns"));

    const result = await main({
      users: [{ name: "existing" }],
      upsert: true,
    });

    expect(calls.updated).toEqual([]);
    expect(calls.operations).toEqual(["lookup:existing"]);
    expect(result).toMatchObject({
      success: true,
      processed: 1,
      created: 0,
      updated: 0,
      skipped: 1,
      errors: [],
    });
  });

  test("reports a create-after-lookup race instead of overwriting the user", async () => {
    const main = await loadSeedMain(generateIdpSeedScriptCode("test-ns"));
    const updated: Array<{ id: string; password?: string }> = [];
    let createAttempted = false;
    (globalThis as { tailor?: unknown }).tailor = {
      idp: {
        Client: class {
          async createUser() {
            createAttempted = true;
            throw new Error("already exists");
          }
          async userByName() {
            if (!createAttempted) throw new Error("not found");
            return { id: "racing-user" };
          }
          async updateUser(input: { id: string; password?: string }) {
            updated.push(input);
          }
        },
      },
    };

    const result = await main({ users: [{ name: "ghost" }], upsert: true });

    expect(result.success).toBe(false);
    expect(result.processed).toBe(0);
    expect(result.created).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.errors[0]).toContain("create failed (already exists)");
    expect(result.errors[0]).toContain("lookup failed (not found)");
    expect(updated).toEqual([]);
  });

  test("preserves the lookup failure reason alongside the create error", async () => {
    const main = await loadSeedMain(generateIdpSeedScriptCode("test-ns"));
    (globalThis as { tailor?: unknown }).tailor = {
      idp: {
        Client: class {
          async createUser() {
            throw new Error("duplicate name");
          }
          async userByName() {
            throw new Error("permission denied");
          }
          async updateUser() {
            throw new Error("should not be called");
          }
        },
      },
    };

    const result = await main({ users: [{ name: "ghost" }], upsert: true });

    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain("create failed (duplicate name)");
    expect(result.errors[0]).toContain("lookup failed (permission denied)");
  });
});

describe("generateIdpTruncateScriptCode", () => {
  aroundEach(async (runTest) => {
    await runTest();
    delete (globalThis as { tailor?: unknown }).tailor;
  });

  test("deletes every user across all pages, following the response page token", async () => {
    const deleted: string[] = [];
    const requests: Array<{ after?: string } | undefined> = [];
    const firstPage: IdpUserPage = {
      users: [
        { id: "1", name: "u1" },
        { id: "2", name: "u2" },
      ],
      nextPageToken: "page2",
    };
    const secondPage: IdpUserPage = {
      users: [
        { id: "3", name: "u3" },
        { id: "4", name: "u4" },
      ],
      nextPageToken: null,
    };

    (globalThis as { tailor?: unknown }).tailor = {
      idp: {
        Client: class {
          async users(options?: { after?: string }): Promise<IdpUserPage> {
            requests.push(options);
            return options?.after === "page2" ? secondPage : firstPage;
          }
          async deleteUser(id: string): Promise<boolean> {
            deleted.push(id);
            return true;
          }
        },
      },
    };

    const main = await loadGeneratedMain(generateIdpTruncateScriptCode("test-ns"));
    const result = await main();

    expect(deleted).toEqual(["1", "2", "3", "4"]);
    expect(result).toMatchObject({ deleted: 4, total: 4, success: true });
    // The loop must request page 2 via `after`; the original bug stopped after
    // page 1 because it read a non-existent `nextToken` response field.
    expect(requests).toEqual([undefined, { after: "page2" }]);
  });

  test("uses the runtime pagination contract keys, not the legacy nextToken", () => {
    const code = generateIdpTruncateScriptCode("my-idp");
    expect(code).toContain("{ after }");
    expect(code).toContain("response.nextPageToken");
    expect(code).not.toContain("nextToken");
  });
});
