import { ScalarType } from "@bufbuild/protobuf";
import { describe, expect, test } from "vitest";
import {
  enumerateAllFieldCompletions,
  getMethodDescriptor,
  listMethodChoices,
  listMethodNames,
  resolveLeafField,
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

describe("listMethodChoices", () => {
  test("includes both bare and fully-qualified method names", () => {
    const choices = listMethodChoices();
    expect(choices).toContain("GetApplication");
    expect(choices).toContain("tailor.v1.OperatorService/GetApplication");
    const sorted = [...choices].sort();
    expect(choices).toEqual(sorted);
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

  test("skips list and map fields (no dotted-path representation)", () => {
    // CreateApplication has `subgraphs` (repeated message). Offering
    // `subgraphs.` or `subgraphs.<sub>=…` would mislead callers into building
    // an object where the proto expects an array, so they must not appear.
    const values = enumerateAllFieldCompletions("CreateApplication").map((c) => c.value);
    expect(values).not.toContain("subgraphs.");
    expect(values.some((v) => v.startsWith("subgraphs."))).toBe(false);
  });

  test("treats google.protobuf well-known types as leaves, not nested objects", () => {
    // UpdateWorkspace has `updateMask` (google.protobuf.FieldMask). proto JSON
    // serializes it as a string ("field1,field2"), so drilling into its
    // internal `paths` repeated field would build a body the server rejects.
    const values = enumerateAllFieldCompletions("UpdateWorkspace").map((c) => c.value);
    expect(values).toContain("updateMask=");
    expect(values).not.toContain("updateMask.");
    expect(values.some((v) => v.startsWith("updateMask."))).toBe(false);
  });
});

describe("resolveLeafField", () => {
  test("resolves a top-level leaf", () => {
    const m = getMethodDescriptor("CreateWorkspace");
    if (!m) throw new Error("CreateWorkspace missing");
    const field = resolveLeafField(m.input, ["deleteProtection"]);
    expect(field?.localName).toBe("deleteProtection");
    expect(field?.fieldKind).toBe("scalar");
    if (field?.fieldKind === "scalar") {
      expect(field.scalar).toBe(ScalarType.BOOL);
    }
  });

  test("resolves a nested leaf through a singular message", () => {
    const m = getMethodDescriptor("CreateTailorDBType");
    if (!m) throw new Error("CreateTailorDBType missing");
    const field = resolveLeafField(m.input, ["tailordbType", "name"]);
    expect(field?.localName).toBe("name");
  });

  test("returns undefined when the path doesn't exist", () => {
    const m = getMethodDescriptor("CreateWorkspace");
    if (!m) throw new Error("CreateWorkspace missing");
    expect(resolveLeafField(m.input, ["nope"])).toBeUndefined();
    expect(resolveLeafField(m.input, ["deleteProtection", "extra"])).toBeUndefined();
  });
});
