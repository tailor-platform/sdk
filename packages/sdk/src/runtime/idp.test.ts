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
    idpM.enqueueResult({ id: "u-1", name: "alice", disabled: false });

    const client = new idp.Client({ namespace: "ns" });
    const result = await client.user("u-1");

    expect(result).toEqual({ id: "u-1", name: "alice", disabled: false });
    expect(idpM.calls).toEqual([{ method: "user", args: ["u-1"], namespace: "ns" }]);
  });

  test("Client.userByName forwards", async () => {
    using idpM = mockIdp();
    idpM.enqueueResult({ id: "u-1", name: "alice", disabled: false });

    const client = new idp.Client({ namespace: "ns" });
    await client.userByName("alice");

    expect(idpM.calls).toEqual([{ method: "userByName", args: ["alice"], namespace: "ns" }]);
  });

  test("Client.users forwards options", async () => {
    using idpM = mockIdp();
    idpM.enqueueResult({
      users: [{ id: "u-1", name: "alice", disabled: false }],
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
      { id: "u-2", name: "bob", disabled: false },
      { id: "u-2", name: "bob2", disabled: false },
      true,
    );

    const client = new idp.Client({ namespace: "ns" });
    await client.createUser({ name: "bob", password: "p" });
    await client.updateUser({ id: "u-2", name: "bob2" });
    const removed = await client.deleteUser("u-2");

    expect(removed).toBe(true);
    expect(idpM.calls.map((c) => c.method)).toEqual(["createUser", "updateUser", "deleteUser"]);
  });

  test("Client.sendPasswordResetEmail forwards", async () => {
    using idpM = mockIdp();
    const client = new idp.Client({ namespace: "ns" });
    const ok = await client.sendPasswordResetEmail({
      userId: "u-1",
      redirectUri: "https://example.com/reset",
    });

    expect(ok).toBe(true);
    expect(idpM.calls).toEqual([
      {
        method: "sendPasswordResetEmail",
        args: [{ userId: "u-1", redirectUri: "https://example.com/reset" }],
        namespace: "ns",
      },
    ]);
  });
});
