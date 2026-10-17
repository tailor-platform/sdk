import { describe, expect, test } from "vitest";
import { fillIdpUserPassword } from "./idp-user-password";

const env = (value?: string) => (value === undefined ? {} : { SEED_USER_PASSWORD: value });

describe("fillIdpUserPassword", () => {
  test("fills a row without password from a plain-string env for every user", () => {
    expect(fillIdpUserPassword({ name: "a@example.com" }, env("secret"))).toEqual({
      name: "a@example.com",
      password: "secret",
    });
  });

  test("reads a JSON object env as a per-user map keyed by name", () => {
    const e = env(JSON.stringify({ "a@example.com": "pa", "b@example.com": "pb" }));
    expect(fillIdpUserPassword({ name: "b@example.com" }, e)).toEqual({
      name: "b@example.com",
      password: "pb",
    });
  });

  test("leaves a user missing from the JSON map without a password", () => {
    const e = env(JSON.stringify({ "a@example.com": "pa" }));
    expect(fillIdpUserPassword({ name: "c@example.com" }, e)).toEqual({ name: "c@example.com" });
  });

  test("keeps the password a row already has", () => {
    expect(
      fillIdpUserPassword({ name: "a@example.com", password: "fromFile" }, env("secret")),
    ).toEqual({ name: "a@example.com", password: "fromFile" });
  });

  test("returns the row unchanged when the env is unset or empty", () => {
    expect(fillIdpUserPassword({ name: "a@example.com" }, env())).toEqual({
      name: "a@example.com",
    });
    expect(fillIdpUserPassword({ name: "a@example.com" }, env(""))).toEqual({
      name: "a@example.com",
    });
  });

  test("treats unparsable JSON and arrays as a plain password", () => {
    expect(fillIdpUserPassword({ name: "a" }, env("{not json"))).toEqual({
      name: "a",
      password: "{not json",
    });
    expect(fillIdpUserPassword({ name: "a" }, env('["x"]'))).toEqual({
      name: "a",
      password: '["x"]',
    });
  });

  test("returns non-object input as is", () => {
    expect(fillIdpUserPassword(null, env("secret"))).toBeNull();
  });
});
