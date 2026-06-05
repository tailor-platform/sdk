import { describe, expect, it } from "vitest";
import { getMethodDescriptor } from "./proto-reflect";
import { normalizeBodyFieldKeys } from "./index";

describe("normalizeBodyFieldKeys", () => {
  it("collapses snake_case body keys to localName so injection cannot duplicate them", () => {
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

  it("keeps the canonical key and drops the alias when both forms are present", () => {
    const method = getMethodDescriptor("GetApplication");
    const body: Record<string, unknown> = { workspaceId: "camel", workspace_id: "snake" };

    normalizeBodyFieldKeys(body, method!.input.fields);

    expect(body).toEqual({ workspaceId: "camel" });
  });

  it("leaves keys that are already canonical or unknown untouched", () => {
    const method = getMethodDescriptor("GetApplication");
    const body: Record<string, unknown> = { workspaceId: "ws-1", unknownField: 1 };

    const changed = normalizeBodyFieldKeys(body, method!.input.fields);

    expect(changed).toBe(false);
    expect(body).toEqual({ workspaceId: "ws-1", unknownField: 1 });
  });
});
