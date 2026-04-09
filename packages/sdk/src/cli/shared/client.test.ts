import { afterEach, describe, test, expect, vi } from "vitest";
import {
  createTransport,
  fetchAll,
  formatRequestParams,
  MAX_PAGE_SIZE,
  parseMethodName,
} from "./client";

vi.mock("@connectrpc/connect-node", () => ({
  createConnectTransport: vi.fn(() => ({ type: "node-transport" })),
}));

describe("createTransport", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("uses connect-node transport with HTTP/2", async () => {
    const transport = await createTransport("https://example.com", []);
    const connectNode = await import("@connectrpc/connect-node");
    expect(connectNode.createConnectTransport).toHaveBeenCalledWith({
      httpVersion: "2",
      baseUrl: "https://example.com",
      interceptors: [],
    });
    expect(transport).toEqual({ type: "node-transport" });
  });
});

describe("fetchAll", () => {
  test("passes MAX_PAGE_SIZE to callback", async () => {
    const fn = vi.fn().mockResolvedValue([["item1"], ""]);

    await fetchAll(fn);

    expect(fn).toHaveBeenCalledWith("", MAX_PAGE_SIZE);
  });
});

describe("parseMethodName", () => {
  test("parses Create methods", () => {
    expect(parseMethodName("CreateWorkflow")).toEqual({
      operation: "create",
      resourceType: "Workflow",
    });
    expect(parseMethodName("CreateTailorDBService")).toEqual({
      operation: "create",
      resourceType: "TailorDBService",
    });
    expect(parseMethodName("CreateTailorDBType")).toEqual({
      operation: "create",
      resourceType: "TailorDBType",
    });
  });

  test("parses Update methods", () => {
    expect(parseMethodName("UpdateWorkflow")).toEqual({
      operation: "update",
      resourceType: "Workflow",
    });
    expect(parseMethodName("UpdateTailorDBType")).toEqual({
      operation: "update",
      resourceType: "TailorDBType",
    });
  });

  test("parses Delete methods", () => {
    expect(parseMethodName("DeleteWorkflow")).toEqual({
      operation: "delete",
      resourceType: "Workflow",
    });
    expect(parseMethodName("DeleteExecutorExecutor")).toEqual({
      operation: "delete",
      resourceType: "ExecutorExecutor",
    });
  });

  test("parses Set methods", () => {
    expect(parseMethodName("SetMetadata")).toEqual({
      operation: "set",
      resourceType: "Metadata",
    });
  });

  test("parses List methods", () => {
    expect(parseMethodName("ListWorkflows")).toEqual({
      operation: "list",
      resourceType: "Workflows",
    });
    expect(parseMethodName("ListWorkflowJobFunctions")).toEqual({
      operation: "list",
      resourceType: "WorkflowJobFunctions",
    });
  });

  test("parses Get methods", () => {
    expect(parseMethodName("GetStaticWebsite")).toEqual({
      operation: "get",
      resourceType: "StaticWebsite",
    });
  });

  test("returns default for unknown method patterns", () => {
    expect(parseMethodName("UnknownMethod")).toEqual({
      operation: "perform",
      resourceType: "resource",
    });
    expect(parseMethodName("")).toEqual({
      operation: "perform",
      resourceType: "resource",
    });
  });
});

describe("formatRequestParams", () => {
  test("serializes plain objects to JSON", () => {
    const obj = { workspaceId: "test-id", name: "test-name" };
    const result = formatRequestParams(obj);
    expect(result).toBe(JSON.stringify(obj, null, 2));
  });

  test("uses toJson method if available (protobuf messages)", () => {
    const protoMessage = {
      workspaceId: "test-id",
      name: "test-name",
      toJson: () => ({ workspaceId: "test-id", name: "test-name" }),
    };
    const result = formatRequestParams(protoMessage);
    expect(result).toBe(JSON.stringify({ workspaceId: "test-id", name: "test-name" }, null, 2));
  });

  test("handles null and undefined", () => {
    expect(formatRequestParams(null)).toBe("null");
    expect(formatRequestParams(undefined)).toBe(undefined);
  });

  test("handles arrays", () => {
    const arr = [1, 2, 3];
    expect(formatRequestParams(arr)).toBe(JSON.stringify(arr, null, 2));
  });

  test("handles primitive values", () => {
    expect(formatRequestParams("string")).toBe('"string"');
    expect(formatRequestParams(123)).toBe("123");
    expect(formatRequestParams(true)).toBe("true");
  });

  test("returns error message for circular references", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(formatRequestParams(circular)).toBe("(unable to serialize request)");
  });

  test("returns error message when toJson throws", () => {
    const badProto = {
      toJson: () => {
        throw new Error("serialization failed");
      },
    };
    expect(formatRequestParams(badProto)).toBe("(unable to serialize request)");
  });

  test("serializes objects containing BigInt values", () => {
    const objWithBigInt = {
      workspaceId: "test-id",
      duration: { seconds: BigInt(3600), nanos: 0 },
    };
    const result = formatRequestParams(objWithBigInt);
    expect(result).toContain('"seconds": "3600"');
    expect(result).toContain('"nanos": 0');
  });

  test("serializes nested BigInt values in toJson result", () => {
    const protoWithBigInt = {
      toJson: () => ({
        accessTokenLifetime: { seconds: BigInt(86400), nanos: 0 },
      }),
    };
    const result = formatRequestParams(protoWithBigInt);
    expect(result).toContain('"seconds": "86400"');
  });
});
