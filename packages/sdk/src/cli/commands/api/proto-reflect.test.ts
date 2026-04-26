import { describe, expect, test } from "vitest";
import { getMethodDescriptor, listMethodNames, resolveFieldByPath } from "./proto-reflect";

describe("listMethodNames", () => {
  test("returns sorted method names including known methods", () => {
    const names = listMethodNames();
    expect(names).toContain("Ping");
    expect(names).toContain("GetApplication");
    expect(names).toContain("ListWorkspaces");
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });
});

describe("getMethodDescriptor", () => {
  test("returns descriptor for known method", () => {
    const m = getMethodDescriptor("GetApplication");
    expect(m?.name).toBe("GetApplication");
    expect(m?.input.fields.map((f) => f.localName)).toEqual(["workspaceId", "applicationName"]);
  });

  test("returns undefined for unknown method", () => {
    expect(getMethodDescriptor("NotARealMethod")).toBeUndefined();
  });
});

describe("resolveFieldByPath", () => {
  test("returns top-level field for single segment", () => {
    const m = getMethodDescriptor("GetApplication");
    if (!m) throw new Error("missing");
    const f = resolveFieldByPath(m.input, ["workspaceId"]);
    expect(f?.localName).toBe("workspaceId");
  });

  test("descends into nested message", () => {
    const m = getMethodDescriptor("CreateTailorDBType");
    if (!m) throw new Error("missing");
    // tailordb_type.name path
    const f = resolveFieldByPath(m.input, ["tailordbType", "name"]);
    expect(f?.localName).toBe("name");
  });

  test("returns undefined when descending into non-message field", () => {
    const m = getMethodDescriptor("GetApplication");
    if (!m) throw new Error("missing");
    const f = resolveFieldByPath(m.input, ["workspaceId", "nope"]);
    expect(f).toBeUndefined();
  });

  test("returns undefined for unknown segment", () => {
    const m = getMethodDescriptor("GetApplication");
    if (!m) throw new Error("missing");
    expect(resolveFieldByPath(m.input, ["nope"])).toBeUndefined();
  });
});
