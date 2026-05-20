import { runCommand } from "politty";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { loadConfig } from "@/cli/shared/config-loader";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { apiCommand } from "./api";

vi.mock("@/cli/shared/context", () => ({
  loadAccessToken: vi.fn(),
  loadWorkspaceId: vi.fn(),
}));

vi.mock("@/cli/shared/config-loader", () => ({
  loadConfig: vi.fn(),
}));

const fetchMock = vi.fn();

describe("api command body auto-injection", () => {
  beforeAll(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadAccessToken).mockResolvedValue("mock-token");
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: "ok" }),
    });
  });

  describe("workspaceId injection", () => {
    test("should inject workspaceId when endpoint requires it and body does not have it", async () => {
      vi.mocked(loadWorkspaceId).mockResolvedValue("resolved-workspace-id");

      await runCommand(apiCommand, ["GetFunctionExecution", "-b", '{"executionId":"exec-1"}']);

      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);
      expect(body.workspaceId).toBe("resolved-workspace-id");
      expect(body.executionId).toBe("exec-1");
    });

    test("should not override workspaceId when already present in body", async () => {
      vi.mocked(loadWorkspaceId).mockResolvedValue("resolved-workspace-id");

      await runCommand(apiCommand, [
        "GetFunctionExecution",
        "-b",
        '{"workspaceId":"user-specified","executionId":"exec-1"}',
      ]);

      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);
      expect(body.workspaceId).toBe("user-specified");
    });

    test("should skip injection when workspaceId cannot be resolved", async () => {
      vi.mocked(loadWorkspaceId).mockRejectedValue(new Error("not found"));

      await runCommand(apiCommand, ["GetFunctionExecution", "-b", '{"executionId":"exec-1"}']);

      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);
      expect(body.workspaceId).toBeUndefined();
      expect(body.executionId).toBe("exec-1");
    });

    test("should not inject workspaceId for endpoints that do not require it", async () => {
      vi.mocked(loadWorkspaceId).mockResolvedValue("resolved-workspace-id");

      await runCommand(apiCommand, ["Ping"]);

      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);
      expect(body.workspaceId).toBeUndefined();
      expect(loadWorkspaceId).not.toHaveBeenCalled();
    });
  });

  describe("namespaceName injection", () => {
    test("should inject namespaceName for Auth endpoint from config", async () => {
      vi.mocked(loadWorkspaceId).mockResolvedValue("ws-1");
      vi.mocked(loadConfig).mockResolvedValue({
        config: {
          name: "my-app",
          auth: { name: "my-auth" },
          path: "/fake",
        },
        generators: [],
        plugins: [],
      } as never);

      await runCommand(apiCommand, ["GetAuthService"]);

      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);
      expect(body.namespaceName).toBe("my-auth");
      expect(body.workspaceId).toBe("ws-1");
    });

    test("should inject namespaceName for TailorDB endpoint when single namespace", async () => {
      vi.mocked(loadWorkspaceId).mockResolvedValue("ws-1");
      vi.mocked(loadConfig).mockResolvedValue({
        config: {
          name: "my-app",
          db: { "my-db": { files: [] } },
          path: "/fake",
        },
        generators: [],
        plugins: [],
      } as never);

      await runCommand(apiCommand, ["ListTailorDBTypes"]);

      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);
      expect(body.namespaceName).toBe("my-db");
    });

    test("should not inject namespaceName for TailorDB when multiple namespaces", async () => {
      vi.mocked(loadWorkspaceId).mockResolvedValue("ws-1");
      vi.mocked(loadConfig).mockResolvedValue({
        config: {
          name: "my-app",
          db: { "db-1": { files: [] }, "db-2": { files: [] } },
          path: "/fake",
        },
        generators: [],
        plugins: [],
      } as never);

      await runCommand(apiCommand, ["ListTailorDBTypes"]);

      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);
      expect(body.namespaceName).toBeUndefined();
    });

    test("should inject namespaceName for IdP endpoint when single IdP", async () => {
      vi.mocked(loadWorkspaceId).mockResolvedValue("ws-1");
      vi.mocked(loadConfig).mockResolvedValue({
        config: {
          name: "my-app",
          idp: [{ name: "my-idp" }],
          path: "/fake",
        },
        generators: [],
        plugins: [],
      } as never);

      await runCommand(apiCommand, ["GetIdPService"]);

      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);
      expect(body.namespaceName).toBe("my-idp");
    });

    test("should inject namespaceName for Pipeline endpoint when single resolver namespace", async () => {
      vi.mocked(loadWorkspaceId).mockResolvedValue("ws-1");
      vi.mocked(loadConfig).mockResolvedValue({
        config: {
          name: "my-app",
          resolver: { "my-pipeline": { files: [] } },
          path: "/fake",
        },
        generators: [],
        plugins: [],
      } as never);

      await runCommand(apiCommand, ["GetPipelineService"]);

      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);
      expect(body.namespaceName).toBe("my-pipeline");
    });

    test("should not override namespaceName when already present in body", async () => {
      vi.mocked(loadWorkspaceId).mockResolvedValue("ws-1");
      vi.mocked(loadConfig).mockResolvedValue({
        config: {
          name: "my-app",
          auth: { name: "my-auth" },
          path: "/fake",
        },
        generators: [],
        plugins: [],
      } as never);

      await runCommand(apiCommand, ["GetAuthService", "-b", '{"namespaceName":"custom-ns"}']);

      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);
      expect(body.namespaceName).toBe("custom-ns");
    });

    test("should skip namespaceName injection when config loading fails", async () => {
      vi.mocked(loadWorkspaceId).mockResolvedValue("ws-1");
      vi.mocked(loadConfig).mockRejectedValue(new Error("config not found"));

      await runCommand(apiCommand, ["GetAuthService"]);

      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);
      expect(body.namespaceName).toBeUndefined();
      expect(body.workspaceId).toBe("ws-1");
    });
  });

  describe("body parsing guards", () => {
    test("should pass through non-object JSON body without attempting injection", async () => {
      await runCommand(apiCommand, ["GetFunctionExecution", "-b", '"just-a-string"']);

      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(options.body).toBe('"just-a-string"');
      expect(loadWorkspaceId).not.toHaveBeenCalled();
    });

    test("should pass through invalid JSON body without attempting injection", async () => {
      await runCommand(apiCommand, ["GetFunctionExecution", "-b", "not-json"]);

      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(options.body).toBe("not-json");
      expect(loadWorkspaceId).not.toHaveBeenCalled();
    });

    test("should not resolve workspaceId when body already contains it", async () => {
      await runCommand(apiCommand, [
        "GetFunctionExecution",
        "-b",
        '{"workspaceId":"ws-provided","executionId":"exec-1"}',
      ]);

      expect(loadWorkspaceId).not.toHaveBeenCalled();
    });
  });

  describe("--field option", () => {
    test("should set a flat field into the body", async () => {
      vi.mocked(loadWorkspaceId).mockResolvedValue("ws-1");

      await runCommand(apiCommand, ["GetFunctionExecution", "-f", "executionId=exec-1"]);

      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);
      expect(body.executionId).toBe("exec-1");
      expect(body.workspaceId).toBe("ws-1");
    });

    test("should set nested fields via dotted keys", async () => {
      await runCommand(apiCommand, [
        "GetFunctionExecution",
        "-f",
        "a.b.c=hello",
        "-f",
        "a.b.d=world",
      ]);

      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);
      expect(body.a).toEqual({ b: { c: "hello", d: "world" } });
    });

    test("should let --field override matching keys in --body", async () => {
      await runCommand(apiCommand, [
        "GetFunctionExecution",
        "-b",
        '{"executionId":"from-body"}',
        "-f",
        "executionId=from-field",
      ]);

      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);
      expect(body.executionId).toBe("from-field");
    });

    test("should destructively overwrite a non-object body value with a nested --field", async () => {
      await runCommand(apiCommand, ["GetFunctionExecution", "-b", '{"a":"str"}', "-f", "a.b=baz"]);

      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);
      expect(body.a).toEqual({ b: "baz" });
    });

    test("should skip workspaceId auto-injection when supplied via --field", async () => {
      await runCommand(apiCommand, [
        "GetFunctionExecution",
        "-f",
        "workspaceId=ws-x",
        "-f",
        "executionId=exec-1",
      ]);

      expect(loadWorkspaceId).not.toHaveBeenCalled();
      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);
      expect(body.workspaceId).toBe("ws-x");
    });

    test("should error when --field is combined with a non-object --body", async () => {
      const result = await runCommand(apiCommand, [
        "GetFunctionExecution",
        "-b",
        '"just-a-string"',
        "-f",
        "executionId=exec-1",
      ]);

      expect(result.success).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    test("should reject malformed --field values", async () => {
      const result = await runCommand(apiCommand, ["GetFunctionExecution", "-f", "no-equals"]);

      expect(result.success).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    test("should reject empty dotted segments in --field key", async () => {
      const result = await runCommand(apiCommand, ["GetFunctionExecution", "-f", "a..b=x"]);

      expect(result.success).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    test("should coerce true/false to booleans for bool-typed fields", async () => {
      vi.mocked(loadWorkspaceId).mockResolvedValue("ws-1");

      await runCommand(apiCommand, [
        "CreateWorkspace",
        "-f",
        "name=ws",
        "-f",
        "deleteProtection=true",
      ]);

      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);
      expect(body.deleteProtection).toBe(true);
      expect(typeof body.deleteProtection).toBe("boolean");
    });

    test("should reject non-boolean values for bool-typed fields", async () => {
      vi.mocked(loadWorkspaceId).mockResolvedValue("ws-1");

      const result = await runCommand(apiCommand, [
        "CreateWorkspace",
        "-f",
        "name=ws",
        "-f",
        "deleteProtection=yes",
      ]);

      expect(result.success).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    test("should leave string scalars unchanged", async () => {
      vi.mocked(loadWorkspaceId).mockResolvedValue("ws-1");

      await runCommand(apiCommand, ["GetFunctionExecution", "-f", "executionId=exec-1"]);

      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);
      expect(body.executionId).toBe("exec-1");
      expect(typeof body.executionId).toBe("string");
    });

    test("should reject prototype-pollution segments in --field key", async () => {
      // Without this guard, `cursor[key]` would resolve `__proto__` against
      // Object.prototype, letting the assignment mutate the global prototype
      // instead of the body.
      const polluted: { polluted?: unknown } = {};
      const before = polluted.polluted;

      const result = await runCommand(apiCommand, [
        "GetFunctionExecution",
        "-f",
        "__proto__.polluted=yes",
      ]);

      expect(result.success).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(polluted.polluted).toBe(before);
      expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
    });
  });
});
