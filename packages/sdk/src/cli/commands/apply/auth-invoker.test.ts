import { describe, expect, it } from "vitest";
import { normalizeAuthInvoker } from "./auth-invoker";

describe("normalizeAuthInvoker", () => {
  it("returns undefined when authInvoker is undefined", () => {
    expect(normalizeAuthInvoker(undefined, "my-auth", "ctx")).toBeUndefined();
  });

  it("expands a string to the object form using authNamespace", () => {
    expect(normalizeAuthInvoker("kiosk", "my-auth", "ctx")).toEqual({
      namespace: "my-auth",
      machineUserName: "kiosk",
    });
  });

  it("passes through object form unchanged", () => {
    expect(
      normalizeAuthInvoker({ namespace: "other-auth", machineUserName: "kiosk" }, "my-auth", "ctx"),
    ).toEqual({
      namespace: "other-auth",
      machineUserName: "kiosk",
    });
  });

  it("throws when string authInvoker is given without an authNamespace", () => {
    expect(() => normalizeAuthInvoker("kiosk", undefined, 'Resolver "foo"')).toThrow(
      /Resolver "foo".*no Auth service is configured/,
    );
  });
});
