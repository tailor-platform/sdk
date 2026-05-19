import { describe, expect, test } from "vitest";
import {
  enumerateAllFieldCompletions,
  getMethodDescriptor,
  listMethodNames,
} from "./proto-reflect";

describe("listMethodNames", () => {
  test("returns sorted method names including known unary methods", () => {
    const names = listMethodNames();
    expect(names).toContain("Ping");
    expect(names).toContain("GetApplication");
    expect(names).toContain("ListWorkspaces");
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });

  test("excludes streaming RPC methods", () => {
    const names = listMethodNames();
    // `apiCall()` only issues one JSON POST and reads one JSON response,
    // so streaming methods cannot succeed and must not be advertised.
    expect(names).not.toContain("CreateFunctionRegistry"); // client_streaming
    expect(names).not.toContain("UpdateFunctionRegistry"); // client_streaming
    expect(names).not.toContain("UploadFile"); // client_streaming
    expect(names).not.toContain("DownloadFunctionRegistryScript"); // server_streaming
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

describe("enumerateAllFieldCompletions", () => {
  test("emits `key=` for each scalar leaf", () => {
    const values = enumerateAllFieldCompletions("GetFunctionExecution").map((c) => c.value);
    expect(values).toContain("workspaceId=");
    expect(values).toContain("executionId=");
  });

  test("emits enum values inline alongside the key for enum leaves", () => {
    const values = enumerateAllFieldCompletions("ListWorkspaces").map((c) => c.value);
    expect(values).toContain("pageDirection=");
    expect(values).toContain("pageDirection=PAGE_DIRECTION_UNSPECIFIED");
    expect(values).toContain("pageDirection=PAGE_DIRECTION_ASC");
    expect(values).toContain("pageDirection=PAGE_DIRECTION_DESC");
  });

  test("emits true/false inline for bool leaves", () => {
    const values = enumerateAllFieldCompletions("CreateWorkspace").map((c) => c.value);
    expect(values).toContain("deleteProtection=");
    expect(values).toContain("deleteProtection=true");
    expect(values).toContain("deleteProtection=false");
  });

  test("emits `key.` drill-down and recurses into nested messages", () => {
    const values = enumerateAllFieldCompletions("CreateTailorDBType").map((c) => c.value);
    expect(values).toContain("tailordbType.");
    expect(values).toContain("tailordbType.name=");
  });

  test("returns an empty list for unknown methods", () => {
    expect(enumerateAllFieldCompletions("NotARealMethod")).toEqual([]);
  });
});
