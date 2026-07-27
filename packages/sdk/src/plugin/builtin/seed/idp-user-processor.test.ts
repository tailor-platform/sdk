import { aroundEach, describe, expect, test } from "vitest";
import {
  generateIdpSeedScriptCode,
  generateIdpTruncateScriptCode,
  generateIdpUserSchemaFile,
  processIdpUser,
} from "./idp-user-processor";
import type { GeneratorAuthInput } from "#/plugin/types";

type TruncateResult = { success: boolean; deleted: number; total: number; errors: string[] };

type SeedResult = { success: boolean; processed: number; errors: string[] };

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
async function loadSeedMain(
  code: string,
): Promise<(input: { users: SeedUser[]; upsert?: boolean }) => Promise<SeedResult>> {
  const url = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  const mod = (await import(/* @vite-ignore */ url)) as {
    main: (input: { users: SeedUser[]; upsert?: boolean }) => Promise<SeedResult>;
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
        typeName: "User",
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
        userTypeName: "User",
      },
    });
  });
});

describe("generateIdpUserSchemaFile", () => {
  const options = { usernameField: "email", userTypeName: "User" };

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
  };

  const stubIdp = (existingByName: Record<string, { id: string }>): IdpCalls => {
    const calls: IdpCalls = { created: [], updated: [], lookups: [] };
    (globalThis as { tailor?: unknown }).tailor = {
      idp: {
        Client: class {
          async createUser(input: SeedUser) {
            if (existingByName[input.name]) {
              throw new Error(`user already exists: ${input.name}`);
            }
            calls.created.push(input);
            return { id: `new-${input.name}` };
          }
          async userByName(name: string) {
            calls.lookups.push(name);
            const found = existingByName[name];
            if (!found) throw new Error(`not found: ${name}`);
            return found;
          }
          async updateUser(input: { id: string; password?: string }) {
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
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
  });

  test("updates existing users instead of failing when upsert is enabled", async () => {
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
    expect(result).toMatchObject({ success: true, processed: 2, errors: [] });
  });

  test("reports an error when an upsert fallback cannot resolve the existing user", async () => {
    stubIdp({});
    const main = await loadSeedMain(generateIdpSeedScriptCode("test-ns"));
    (globalThis as { tailor?: unknown }).tailor = {
      idp: {
        Client: class {
          async createUser() {
            throw new Error("already exists");
          }
          async userByName() {
            throw new Error("lookup exploded");
          }
        },
      },
    };

    const result = await main({ users: [{ name: "ghost" }], upsert: true });

    expect(result.success).toBe(false);
    expect(result.processed).toBe(0);
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
