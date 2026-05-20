import { describe, expect, test } from "vitest";
import { getMethodDescriptor, listMethodNames } from "./proto-reflect";

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
