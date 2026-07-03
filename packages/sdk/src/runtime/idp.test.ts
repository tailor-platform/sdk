/**
 * Tests for `@tailor-platform/sdk/runtime/idp` typed wrappers.
 *
 * Verifies that {@link idp.Client} forwards each method to the platform's
 * `tailor.idp.Client` and records calls with method, args, and namespace.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import * as idp from "#/runtime/idp";
import { cleanupMocks, mockIdp, injectMocks } from "#/vitest/mock";

describe("@tailor-platform/sdk/runtime/idp", () => {
  beforeEach(() => {
    injectMocks(globalThis);
  });

  afterEach(() => {
    cleanupMocks(globalThis);
  });

  test("Client.user forwards args and namespace", async () => {
    using idpM = mockIdp();
    idpM.enqueueResult({
      id: "11111111-1111-4111-8111-111111111111",
      name: "alice",
      disabled: false,
    });

    const client = new idp.Client({ namespace: "ns" });
    const result = await client.user("11111111-1111-4111-8111-111111111111");

    expect(result).toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      name: "alice",
      disabled: false,
    });
    expect(idpM.calls).toEqual([
      { method: "user", args: ["11111111-1111-4111-8111-111111111111"], namespace: "ns" },
    ]);
  });

  test("Client.userByName forwards", async () => {
    using idpM = mockIdp();
    idpM.enqueueResult({
      id: "11111111-1111-4111-8111-111111111111",
      name: "alice",
      disabled: false,
    });

    const client = new idp.Client({ namespace: "ns" });
    await client.userByName("alice");

    expect(idpM.calls).toEqual([{ method: "userByName", args: ["alice"], namespace: "ns" }]);
  });

  test("Client.users forwards options", async () => {
    using idpM = mockIdp();
    idpM.enqueueResult({
      users: [{ id: "11111111-1111-4111-8111-111111111111", name: "alice", disabled: false }],
      nextPageToken: null,
      totalCount: 1,
    });

    const client = new idp.Client({ namespace: "ns" });
    const result = await client.users({ first: 10 });

    expect(result.totalCount).toBe(1);
    expect(idpM.calls).toEqual([{ method: "users", args: [{ first: 10 }], namespace: "ns" }]);
  });

  test("Client.createUser / updateUser / deleteUser forward", async () => {
    using idpM = mockIdp();
    idpM.enqueueResults(
      { id: "22222222-2222-4222-8222-222222222222", name: "bob", disabled: false },
      { id: "22222222-2222-4222-8222-222222222222", name: "bob2", disabled: false },
      true,
    );

    const client = new idp.Client({ namespace: "ns" });
    await client.createUser({ name: "bob", password: "p" });
    await client.updateUser({ id: "22222222-2222-4222-8222-222222222222", name: "bob2" });
    const removed = await client.deleteUser("22222222-2222-4222-8222-222222222222");

    expect(removed).toBe(true);
    expect(idpM.calls.map((c) => c.method)).toEqual(["createUser", "updateUser", "deleteUser"]);
  });

  test("Client.sendPasswordResetEmail forwards", async () => {
    using idpM = mockIdp();
    const client = new idp.Client({ namespace: "ns" });
    const args = {
      userId: "11111111-1111-4111-8111-111111111111",
      redirectUri: "https://example.com/reset",
    } as const;
    const ok = await client.sendPasswordResetEmail(args);

    expect(ok).toBe(true);
    expect(idpM.calls).toEqual([
      { method: "sendPasswordResetEmail", args: [args], namespace: "ns" },
    ]);
  });

  test("Client.unenrollMfa forwards", async () => {
    using idpM = mockIdp();
    const client = new idp.Client({ namespace: "ns" });
    const args = {
      userId: "11111111-1111-4111-8111-111111111111",
      mfaFactorId: "f-1",
    } as const;
    const ok = await client.unenrollMfa(args);

    expect(ok).toBe(true);
    expect(idpM.calls).toEqual([{ method: "unenrollMfa", args: [args], namespace: "ns" }]);
  });
});
