import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, test } from "vitest";
import { mockOperatorClient } from "#/cli/shared/test-helpers/operator-client";
import { listInvokerMachineUsers, normalizeInvoker } from "./invoker";

describe("normalizeInvoker", () => {
  test("returns undefined when invoker is undefined", () => {
    expect(normalizeInvoker(undefined, "my-auth", "ctx", undefined)).toBeUndefined();
  });

  test("expands a string to the object form using authNamespace", () => {
    expect(normalizeInvoker("kiosk", "my-auth", "ctx", undefined)).toEqual({
      namespace: "my-auth",
      machineUserName: "kiosk",
    });
  });

  test("passes through object form unchanged", () => {
    expect(
      normalizeInvoker(
        { namespace: "other-auth", machineUserName: "kiosk" },
        "my-auth",
        "ctx",
        undefined,
      ),
    ).toEqual({
      namespace: "other-auth",
      machineUserName: "kiosk",
    });
  });

  test("throws when string invoker is given without an authNamespace", () => {
    expect(() => normalizeInvoker("kiosk", undefined, 'Resolver "foo"', undefined)).toThrow(
      expect.objectContaining({
        code: "INVOKER_AUTH_REQUIRED",
        message: expect.stringContaining('Resolver "foo"'),
        suggestion: "Configure an Auth service before using invoker.",
      }),
    );
  });

  describe("with the machine users of each Auth namespace", () => {
    const machineUsers = new Map([
      ["my-auth", new Set(["kiosk", "batch"])],
      ["other-auth", new Set(["portal"])],
      ["gone-auth", null],
    ]);

    test("expands a string invoker that exists in the auth namespace", () => {
      expect(normalizeInvoker("kiosk", "my-auth", "ctx", machineUsers)).toEqual({
        namespace: "my-auth",
        machineUserName: "kiosk",
      });
    });

    test("throws when a string invoker does not exist in the auth namespace", () => {
      expect(() =>
        normalizeInvoker("kiosk-typo", "my-auth", 'Resolver "foo"', machineUsers),
      ).toThrow(
        expect.objectContaining({
          code: "INVOKER_MACHINE_USER_NOT_FOUND",
          message: expect.stringContaining('Resolver "foo"'),
          context: expect.objectContaining({
            invoker: "kiosk-typo",
            authNamespace: "my-auth",
            machineUsers: ["batch", "kiosk"],
          }),
        }),
      );
    });

    test("accepts an object invoker whose namespace has the machine user", () => {
      expect(
        normalizeInvoker(
          { namespace: "other-auth", machineUserName: "portal" },
          "my-auth",
          "ctx",
          machineUsers,
        ),
      ).toEqual({ namespace: "other-auth", machineUserName: "portal" });
    });

    test("throws when the namespace of an object invoker lacks the machine user", () => {
      expect(() =>
        normalizeInvoker(
          { namespace: "other-auth", machineUserName: "kiosk" },
          "my-auth",
          'Resolver "foo"',
          machineUsers,
        ),
      ).toThrow(
        expect.objectContaining({
          code: "INVOKER_MACHINE_USER_NOT_FOUND",
          context: { invoker: "kiosk", authNamespace: "other-auth", machineUsers: ["portal"] },
        }),
      );
    });

    test.for([
      { label: "a string invoker", invoker: "kiosk", authNamespace: "gone-auth" },
      {
        label: "an object invoker",
        invoker: { namespace: "gone-auth", machineUserName: "kiosk" },
        authNamespace: "my-auth",
      },
    ])("throws when the Auth namespace of $label does not exist", ({ invoker, authNamespace }) => {
      expect(() =>
        normalizeInvoker(invoker, authNamespace, 'Resolver "foo"', machineUsers),
      ).toThrow(
        expect.objectContaining({
          code: "INVOKER_AUTH_NOT_FOUND",
          message: expect.stringContaining('Resolver "foo"'),
          context: { invoker: "kiosk", authNamespace: "gone-auth" },
        }),
      );
    });
  });
});

describe("listInvokerMachineUsers", () => {
  function clientWithMachineUsers(byNamespace: Record<string, string[]>) {
    return mockOperatorClient({
      listAuthMachineUsers: async ({ workspaceId, authNamespace }) => {
        expect(workspaceId).toBe("ws");
        const names = byNamespace[authNamespace ?? ""];
        if (!names) throw new ConnectError("auth namespace not found", Code.NotFound);
        return { machineUsers: names.map((name) => ({ name })), nextPageToken: "" };
      },
    });
  }

  test("lists the workspace machine users of each namespace that a string or object invoker names", async () => {
    const client = clientWithMachineUsers({ "my-auth": ["kiosk"], "other-auth": ["portal"] });

    const machineUsers = await listInvokerMachineUsers({
      client,
      workspaceId: "ws",
      invokers: ["kiosk", { namespace: "other-auth", machineUserName: "portal" }, undefined],
      authNamespace: "my-auth",
    });

    expect(machineUsers).toEqual(
      new Map([
        ["my-auth", new Set(["kiosk"])],
        ["other-auth", new Set(["portal"])],
      ]),
    );
  });

  test("uses the machine users the run defines as the final set, without the workspace", async () => {
    const client = clientWithMachineUsers({ "my-auth": ["legacy", "admin"] });

    const machineUsers = await listInvokerMachineUsers({
      client,
      workspaceId: "ws",
      invokers: ["admin"],
      authNamespace: "my-auth",
      plannedMachineUsers: new Map([["my-auth", new Set(["admin"])]]),
    });

    expect(machineUsers).toEqual(new Map([["my-auth", new Set(["admin"])]]));
    expect(client.listAuthMachineUsers).not.toHaveBeenCalled();
  });

  test("maps a namespace the workspace does not have to null", async () => {
    const client = clientWithMachineUsers({});

    const machineUsers = await listInvokerMachineUsers({
      client,
      workspaceId: "ws",
      invokers: [{ namespace: "gone-auth", machineUserName: "kiosk" }],
      authNamespace: undefined,
    });

    expect(machineUsers).toEqual(new Map([["gone-auth", null]]));
  });

  test("returns undefined when no invoker names an Auth namespace", async () => {
    const client = clientWithMachineUsers({});

    await expect(
      listInvokerMachineUsers({
        client,
        workspaceId: "ws",
        invokers: [undefined, "kiosk"],
        authNamespace: undefined,
      }),
    ).resolves.toBeUndefined();
    expect(client.listAuthMachineUsers).not.toHaveBeenCalled();
  });
});
