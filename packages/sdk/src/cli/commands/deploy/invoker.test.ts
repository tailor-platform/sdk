import { describe, expect, test } from "vitest";
import { normalizeInvoker } from "./invoker";

describe("normalizeInvoker", () => {
  test("returns undefined when invoker is undefined", () => {
    expect(normalizeInvoker(undefined, "my-auth", "ctx")).toBeUndefined();
  });

  test("expands a string to the object form using authNamespace", () => {
    expect(normalizeInvoker("kiosk", "my-auth", "ctx")).toEqual({
      namespace: "my-auth",
      machineUserName: "kiosk",
    });
  });

  test("passes through object form unchanged", () => {
    expect(
      normalizeInvoker({ namespace: "other-auth", machineUserName: "kiosk" }, "my-auth", "ctx"),
    ).toEqual({
      namespace: "other-auth",
      machineUserName: "kiosk",
    });
  });

  test("throws when string invoker is given without an authNamespace", () => {
    expect(() => normalizeInvoker("kiosk", undefined, 'Resolver "foo"')).toThrow(
      /Resolver "foo".*Configure an Auth service before using invoker/,
    );
  });
});
