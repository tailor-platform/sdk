import { afterEach, describe, expect, test } from "vitest";
import {
  generateIdpTruncateScriptCode,
  generateIdpUserSchemaFile,
  processIdpUser,
} from "./idp-user-processor";
import type { GeneratorAuthInput } from "#src/plugin/types";

type TruncateResult = { success: boolean; deleted: number; total: number; errors: string[] };

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

describe("generateIdpTruncateScriptCode", () => {
  afterEach(() => {
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
