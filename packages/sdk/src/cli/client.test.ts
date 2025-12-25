import { describe, test, expect } from "vitest";
import { formatRequestParams, parseMethodName } from "./client";

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
});
