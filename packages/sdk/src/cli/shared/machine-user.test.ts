import { describe, expect, test } from "vitest";
import {
  authNamespacesDefining,
  acceptsPinnedMachineUser,
  parseMachineUserRef,
  resolveMachineUser,
} from "./machine-user";

const corp = { name: "corp-auth", machineUsers: ["admin", "seeder"] };
const partner = { name: "partner-auth", machineUsers: ["admin"] };

describe("parseMachineUserRef", () => {
  test("reads a bare name", () => {
    expect(parseMachineUserRef("admin")).toEqual({ name: "admin" });
  });

  test("reads an Auth-qualified name", () => {
    expect(parseMachineUserRef("corp-auth/admin")).toEqual({
      authNamespace: "corp-auth",
      name: "admin",
    });
  });

  test.each(["/admin", "corp-auth/", "a/b/c"])("rejects %s", (value) => {
    expect(() => parseMachineUserRef(value)).toThrow(
      expect.objectContaining({ code: "MACHINE_USER_INVALID" }),
    );
  });
});

describe("authNamespacesDefining", () => {
  test("lists the Auth services that define the machine user", () => {
    expect(authNamespacesDefining("admin", [corp, partner])).toEqual(["corp-auth", "partner-auth"]);
    expect(authNamespacesDefining("seeder", [corp, partner])).toEqual(["corp-auth"]);
  });
});

describe("resolveMachineUser", () => {
  test("uses the only Auth service for a bare name, as before", () => {
    expect(
      resolveMachineUser({
        value: "anyone",
        auths: [{ name: "app-auth", machineUsers: undefined }],
      }),
    ).toEqual({ namespace: "app-auth", machineUserName: "anyone" });
  });

  test("finds the Auth service that defines a bare name among several", () => {
    expect(resolveMachineUser({ value: "seeder", auths: [corp, partner] })).toEqual({
      namespace: "corp-auth",
      machineUserName: "seeder",
    });
  });

  test("uses the Auth service a qualified name gives", () => {
    expect(resolveMachineUser({ value: "partner-auth/admin", auths: [corp, partner] })).toEqual({
      namespace: "partner-auth",
      machineUserName: "admin",
    });
  });

  test("rejects a bare name that several Auth services define", () => {
    expect(() => resolveMachineUser({ value: "admin", auths: [corp, partner] })).toThrow(
      expect.objectContaining({
        code: "MACHINE_USER_AMBIGUOUS",
        suggestion: expect.stringContaining("corp-auth/admin"),
        context: {
          machineUsers: [{ machineUser: "admin", authNamespaces: ["corp-auth", "partner-auth"] }],
        },
      }),
    );
  });

  test("rejects a bare name no Auth service defines", () => {
    expect(() => resolveMachineUser({ value: "ghost", auths: [corp, partner] })).toThrow(
      expect.objectContaining({ code: "MACHINE_USER_NOT_FOUND" }),
    );
  });

  test("rejects a qualified name whose Auth service the config does not define", () => {
    expect(() => resolveMachineUser({ value: "other-auth/admin", auths: [corp, partner] })).toThrow(
      expect.objectContaining({ code: "AUTH_NOT_FOUND" }),
    );
  });

  test("rejects a qualified name its Auth service does not define", () => {
    expect(() =>
      resolveMachineUser({ value: "partner-auth/seeder", auths: [corp, partner] }),
    ).toThrow(expect.objectContaining({ code: "MACHINE_USER_NOT_FOUND" }));
  });

  test("requires an Auth service", () => {
    expect(() => resolveMachineUser({ value: "admin", auths: [] })).toThrow(
      expect.objectContaining({ code: "AUTH_CONFIG_REQUIRED" }),
    );
  });
});

describe("acceptsPinnedMachineUser", () => {
  test.each([
    ["admin", "admin", true],
    ["admin", "corp-auth/admin", false],
    ["corp-auth/admin", "admin", true],
    ["corp-auth/admin", "corp-auth/admin", true],
    ["corp-auth/admin", "partner-auth/admin", false],
    ["admin", "seeder", false],
  ])("pinned %s, explicit %s: %s", (pinned, explicit, expected) => {
    expect(acceptsPinnedMachineUser(pinned, explicit)).toBe(expected);
  });
});
