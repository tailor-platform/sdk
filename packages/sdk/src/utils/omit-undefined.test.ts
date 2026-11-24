import { describe, expect, test } from "vitest";
import { omitUndefined } from "./omit-undefined";

describe("omitUndefined", () => {
  test("removes keys whose value is undefined", () => {
    const result = omitUndefined({ pageToken: undefined, workspaceId: "ws-1" });

    expect(Object.keys(result)).toEqual(["workspaceId"]);
  });

  test("keeps falsy values other than undefined", () => {
    const result = omitUndefined({ dryRun: false, limit: 0, name: "", token: null });

    expect(result).toEqual({ dryRun: false, limit: 0, name: "", token: null });
  });

  test("returns a type whose undefined-able keys are optional", () => {
    const input: { profile: string | undefined; workspaceId: string } = {
      profile: undefined,
      workspaceId: "ws-1",
    };

    const result: { profile?: string; workspaceId: string } = omitUndefined(input);

    expect(result).toEqual({ workspaceId: "ws-1" });
  });
  test("removes undefined keys inside nested objects and array elements", () => {
    const result = omitUndefined({
      policy: { mfaIssuer: undefined, lang: "en" },
      items: [{ description: undefined, value: "a" }],
    });

    expect(result).toEqual({ policy: { lang: "en" }, items: [{ value: "a" }] });
    expect("mfaIssuer" in result.policy).toBe(false);
    expect("description" in (result.items[0] ?? {})).toBe(false);
  });

  test("keeps bigint, Date and Uint8Array values as they are", () => {
    const date = new Date(0);
    const bytes = new Uint8Array([1]);

    const result = omitUndefined({ seconds: 1n, date, bytes });

    expect(result.seconds).toBe(1n);
    expect(result.date).toBe(date);
    expect(result.bytes).toBe(bytes);
  });
});
