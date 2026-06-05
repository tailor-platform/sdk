import { describe, expect, test } from "vitest";
import { normalizeAuthInvoker } from "./auth-invoker";

describe("normalizeAuthInvoker", () => {
  test("returns undefined when authInvoker is undefined", () => {
    expect(normalizeAuthInvoker(undefined, "my-auth", "ctx")).toBeUndefined();
  });

  test("expands a string to the object form using authNamespace", () => {
    expect(normalizeAuthInvoker("kiosk", "my-auth", "ctx")).toEqual({
      namespace: "my-auth",
      machineUserName: "kiosk",
    });
  });

  test("passes through object form unchanged", () => {
    expect(
      normalizeAuthInvoker({ namespace: "other-auth", machineUserName: "kiosk" }, "my-auth", "ctx"),
    ).toEqual({
      namespace: "other-auth",
      machineUserName: "kiosk",
    });
  });

  test("throws when string authInvoker is given without an authNamespace", () => {
    expect(() => normalizeAuthInvoker("kiosk", undefined, 'Resolver "foo"')).toThrow(
      /Resolver "foo".*no Auth service is configured/,
    );
  });
});
