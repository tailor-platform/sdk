import { describe, expect, test, vi } from "vitest";
import { listInvokerMachineUsers, normalizeInvoker } from "./invoker";
import type { Application } from "#/cli/services/application";
import type { OperatorClient } from "#/cli/shared/client";

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

  describe("with known machine users", () => {
    const known = new Set(["kiosk", "batch"]);

    test("expands a string invoker that exists in the auth namespace", () => {
      expect(normalizeInvoker("kiosk", "my-auth", "ctx", known)).toEqual({
        namespace: "my-auth",
        machineUserName: "kiosk",
      });
    });

    test("throws when a string invoker does not exist in the auth namespace", () => {
      expect(() => normalizeInvoker("kiosk-typo", "my-auth", 'Resolver "foo"', known)).toThrow(
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

    test("does not check the object form, which names its own namespace", () => {
      expect(
        normalizeInvoker(
          { namespace: "other-auth", machineUserName: "unknown" },
          "my-auth",
          "ctx",
          known,
        ),
      ).toEqual({ namespace: "other-auth", machineUserName: "unknown" });
    });
  });
});

describe("listInvokerMachineUsers", () => {
  function clientWithMachineUsers(names: string[]) {
    const listAuthMachineUsers = vi.fn().mockResolvedValue({
      machineUsers: names.map((name) => ({ name })),
      nextPageToken: "",
    });
    return {
      client: { listAuthMachineUsers } as unknown as OperatorClient,
      listAuthMachineUsers,
    };
  }

  function applicationWithAuth(authNamespace: string | undefined): Readonly<Application> {
    return {
      config: authNamespace ? { auth: { name: authNamespace, external: true } } : {},
    } as unknown as Readonly<Application>;
  }

  test("lists the machine users of the workspace when no config in the run defines the namespace", async () => {
    const { client, listAuthMachineUsers } = clientWithMachineUsers(["kiosk"]);

    const known = await listInvokerMachineUsers({
      client,
      workspaceId: "ws",
      application: applicationWithAuth("my-auth"),
    });

    expect([...known!]).toEqual(["kiosk"]);
    expect(listAuthMachineUsers).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws", authNamespace: "my-auth" }),
    );
  });

  test("uses the machine users the run defines as the final set, without the workspace", async () => {
    const { client, listAuthMachineUsers } = clientWithMachineUsers(["legacy", "admin"]);

    const known = await listInvokerMachineUsers({
      client,
      workspaceId: "ws",
      application: applicationWithAuth("my-auth"),
      plannedMachineUsers: new Map([["my-auth", new Set(["admin"])]]),
    });

    expect([...known!]).toEqual(["admin"]);
    expect(listAuthMachineUsers).not.toHaveBeenCalled();
  });

  test("returns undefined when the application has no auth namespace", async () => {
    const { client } = clientWithMachineUsers([]);

    await expect(
      listInvokerMachineUsers({
        client,
        workspaceId: "ws",
        application: applicationWithAuth(undefined),
      }),
    ).resolves.toBeUndefined();
  });
});
