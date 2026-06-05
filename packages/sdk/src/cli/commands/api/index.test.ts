import { describe, expect, test } from "vitest";
import { getMethodDescriptor } from "./proto-reflect";
import { normalizeBodyFieldKeys } from "./index";

describe("normalizeBodyFieldKeys", () => {
  test("collapses snake_case body keys to localName so injection cannot duplicate them", () => {
    // Reproduces the AddCustomDomain regression: a --body written in snake_case
    // must be recognized so workspaceId is not injected a second time.
    const method = getMethodDescriptor("AddCustomDomain");
    expect(method).toBeDefined();

    const body: Record<string, unknown> = {
      workspace_id: "ws-1",
      static_website_name: "site",
      domain: "example.com",
    };
    const changed = normalizeBodyFieldKeys(body, method!.input.fields);

    expect(changed).toBe(true);
    expect(body).toEqual({
      workspaceId: "ws-1",
      staticWebsiteName: "site",
      domain: "example.com",
    });
    expect("workspace_id" in body).toBe(false);
  });

  test("keeps the canonical key and drops the alias when both forms are present", () => {
    const method = getMethodDescriptor("GetApplication");
    const body: Record<string, unknown> = { workspaceId: "camel", workspace_id: "snake" };

    normalizeBodyFieldKeys(body, method!.input.fields);

    expect(body).toEqual({ workspaceId: "camel" });
  });

  test("leaves keys that are already canonical or unknown untouched", () => {
    const method = getMethodDescriptor("GetApplication");
    const body: Record<string, unknown> = { workspaceId: "ws-1", unknownField: 1 };

    const changed = normalizeBodyFieldKeys(body, method!.input.fields);

    expect(changed).toBe(false);
    expect(body).toEqual({ workspaceId: "ws-1", unknownField: 1 });
  });

  test("uses own-property checks so a field whose localName is a prototype key keeps its value", () => {
    // `toString` lives on Object.prototype; an `in` check would treat the
    // canonical key as already present and drop the alias value rather than
    // moving it. normalizeBodyFieldKeys must use an own-property check.
    const fields = [
      { name: "to_string", jsonName: "toString", localName: "toString" },
    ] as unknown as Parameters<typeof normalizeBodyFieldKeys>[1];
    const body: Record<string, unknown> = { to_string: "kept" };

    const changed = normalizeBodyFieldKeys(body, fields);

    expect(changed).toBe(true);
    expect(Object.hasOwn(body, "toString")).toBe(true);
    expect(body.toString).toBe("kept");
    expect("to_string" in body).toBe(false);
  });
});
