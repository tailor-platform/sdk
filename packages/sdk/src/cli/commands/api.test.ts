import { runCommand } from "politty";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { loadConfig } from "#/cli/shared/config-loader";
import { loadAccessToken, loadPlatformClientConfig, loadWorkspaceId } from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";
import { apiCall, apiCommand } from "./api";

vi.mock("#/cli/shared/context", () => ({
  loadAccessToken: vi.fn(),
  loadPlatformClientConfig: vi.fn(),
  loadWorkspaceId: vi.fn(),
}));

vi.mock("#/cli/shared/config-loader", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("#/cli/shared/readonly-guard", () => ({
  assertWritable: vi.fn(),
}));

const fetchMock = vi.fn();

function getRawRequestBody(): string {
  const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
  return options.body as string;
}

function getRequestBody(): Record<string, unknown> {
  return JSON.parse(getRawRequestBody());
}

function mockConfigWith(config: Record<string, unknown>): void {
  vi.mocked(loadConfig).mockResolvedValue({
    config: { name: "my-app", path: "/fake", ...config },
    generators: [],
    plugins: [],
  } as never);
}

describe("api command body auto-injection", () => {
  beforeAll(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadPlatformClientConfig).mockResolvedValue(undefined);
    vi.mocked(loadAccessToken).mockResolvedValue("mock-token");
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: "ok" }),
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("profile config precedence", () => {
    test("uses env access tokens even when the selected profile config cannot be loaded", async () => {
      vi.stubEnv("TAILOR_PLATFORM_TOKEN", "env-token");
      vi.mocked(loadAccessToken).mockResolvedValue("env-token");
      vi.mocked(loadPlatformClientConfig).mockRejectedValue(
        new Error('Profile "missing" not found'),
      );
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ result: "ok" }),
      });

      const result = await apiCall({ profile: "missing", endpoint: "Ping" });

      expect(result).toEqual({ status: 200, data: { result: "ok" } });
      expect(loadAccessToken).toHaveBeenCalledWith({ profile: "missing" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.tailor.tech/tailor.v1.OperatorService/Ping");
      expect((options.headers as Record<string, string>).Authorization).toBe("Bearer env-token");
    });

    test("does not suppress profile config errors for empty env access tokens", async () => {
      vi.stubEnv("TAILOR_PLATFORM_TOKEN", "");
      vi.mocked(loadAccessToken).mockResolvedValue("profile-token");
      vi.mocked(loadPlatformClientConfig).mockRejectedValue(
        new Error('Profile "missing" not found'),
      );

      await expect(apiCall({ profile: "missing", endpoint: "Ping" })).rejects.toThrow(
        'Profile "missing" not found',
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("workspaceId injection", () => {
    test("should inject workspaceId when endpoint requires it and body does not have it", async () => {
      vi.mocked(loadWorkspaceId).mockResolvedValue("resolved-workspace-id");

      await runCommand(apiCommand, ["GetFunctionExecution", "-b", '{"executionId":"exec-1"}']);

      const body = getRequestBody();
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

      expect(getRequestBody().workspaceId).toBe("user-specified");
    });

    test("should skip injection when workspaceId cannot be resolved", async () => {
      vi.mocked(loadWorkspaceId).mockRejectedValue(new Error("not found"));

      await runCommand(apiCommand, ["GetFunctionExecution", "-b", '{"executionId":"exec-1"}']);

      const body = getRequestBody();
      expect(body.workspaceId).toBeUndefined();
      expect(body.executionId).toBe("exec-1");
    });

    test("should not inject workspaceId for endpoints that do not require it", async () => {
      vi.mocked(loadWorkspaceId).mockResolvedValue("resolved-workspace-id");

      await runCommand(apiCommand, ["Ping"]);

      expect(getRequestBody().workspaceId).toBeUndefined();
      expect(loadWorkspaceId).not.toHaveBeenCalled();
    });
  });

  describe("namespaceName injection", () => {
    test("should inject namespaceName for Auth endpoint from config", async () => {
      vi.mocked(loadWorkspaceId).mockResolvedValue("ws-1");
      mockConfigWith({ auth: { name: "my-auth" } });

      await runCommand(apiCommand, ["GetAuthService"]);

      const body = getRequestBody();
      expect(body.namespaceName).toBe("my-auth");
      expect(body.workspaceId).toBe("ws-1");
    });

    test("should inject namespaceName for TailorDB endpoint when single namespace", async () => {
      vi.mocked(loadWorkspaceId).mockResolvedValue("ws-1");
      mockConfigWith({ db: { "my-db": { files: [] } } });

      await runCommand(apiCommand, ["ListTailorDBTypes"]);

      expect(getRequestBody().namespaceName).toBe("my-db");
    });

    test("should not inject namespaceName for TailorDB when multiple namespaces", async () => {
      vi.mocked(loadWorkspaceId).mockResolvedValue("ws-1");
      mockConfigWith({ db: { "db-1": { files: [] }, "db-2": { files: [] } } });

      await runCommand(apiCommand, ["ListTailorDBTypes"]);

      expect(getRequestBody().namespaceName).toBeUndefined();
    });

    test("should inject namespaceName for IdP endpoint when single IdP", async () => {
      vi.mocked(loadWorkspaceId).mockResolvedValue("ws-1");
      mockConfigWith({ idp: [{ name: "my-idp" }] });

      await runCommand(apiCommand, ["GetIdPService"]);

      expect(getRequestBody().namespaceName).toBe("my-idp");
    });

    test("should inject namespaceName for Pipeline endpoint when single resolver namespace", async () => {
      vi.mocked(loadWorkspaceId).mockResolvedValue("ws-1");
      mockConfigWith({ resolver: { "my-pipeline": { files: [] } } });

      await runCommand(apiCommand, ["GetPipelineService"]);

      expect(getRequestBody().namespaceName).toBe("my-pipeline");
    });

    test("should not override namespaceName when already present in body", async () => {
      vi.mocked(loadWorkspaceId).mockResolvedValue("ws-1");
      mockConfigWith({ auth: { name: "my-auth" } });

      await runCommand(apiCommand, ["GetAuthService", "-b", '{"namespaceName":"custom-ns"}']);

      expect(getRequestBody().namespaceName).toBe("custom-ns");
    });

    test("should skip namespaceName injection when config loading fails", async () => {
      vi.mocked(loadWorkspaceId).mockResolvedValue("ws-1");
      vi.mocked(loadConfig).mockRejectedValue(new Error("config not found"));

      await runCommand(apiCommand, ["GetAuthService"]);

      const body = getRequestBody();
      expect(body.namespaceName).toBeUndefined();
      expect(body.workspaceId).toBe("ws-1");
    });
  });

  describe("response output stream", () => {
    test("writes JSON response to stdout, not stderr", async () => {
      using stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      using stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: "ok", value: 42 }),
      });

      await runCommand(apiCommand, ["Ping"]);

      const stdoutContent = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
      const stderrContent = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(stdoutContent).toContain('"result"');
      expect(stdoutContent).toContain('"ok"');
      expect(stderrContent).not.toContain('"result"');
    });

    test("in jsonMode writes JSON response to stdout", async () => {
      using stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      using stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      using consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      using _jsonMode = vi.spyOn(logger, "jsonMode", "get").mockReturnValue(true);
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: "ok", value: 42 }),
      });

      await runCommand(apiCommand, ["Ping"]);

      const stdoutContent = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
      const consoleContent = consoleLogSpy.mock.calls.map((c) => String(c[0])).join("");
      const allStdout = stdoutContent + consoleContent;
      const stderrContent = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(allStdout).toContain('"result"');
      expect(allStdout).toContain('"ok"');
      expect(stderrContent).not.toContain('"result"');
    });
  });

  describe("body parsing guards", () => {
    test("should pass through non-object JSON body without attempting injection", async () => {
      await runCommand(apiCommand, ["GetFunctionExecution", "-b", '"just-a-string"']);

      expect(getRawRequestBody()).toBe('"just-a-string"');
      expect(loadWorkspaceId).not.toHaveBeenCalled();
    });

    test("should pass through invalid JSON body without attempting injection", async () => {
      await runCommand(apiCommand, ["GetFunctionExecution", "-b", "not-json"]);

      expect(getRawRequestBody()).toBe("not-json");
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

      const body = getRequestBody();
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

      expect(getRequestBody().a).toEqual({ b: { c: "hello", d: "world" } });
    });

    test("should let --field override matching keys in --body", async () => {
      await runCommand(apiCommand, [
        "GetFunctionExecution",
        "-b",
        '{"executionId":"from-body"}',
        "-f",
        "executionId=from-field",
      ]);

      expect(getRequestBody().executionId).toBe("from-field");
    });

    test("should destructively overwrite a non-object body value with a nested --field", async () => {
      await runCommand(apiCommand, ["GetFunctionExecution", "-b", '{"a":"str"}', "-f", "a.b=baz"]);

      expect(getRequestBody().a).toEqual({ b: "baz" });
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
      expect(getRequestBody().workspaceId).toBe("ws-x");
    });

    test.each([
      [
        "should error when --field is combined with a non-object --body",
        ["-b", '"just-a-string"', "-f", "executionId=exec-1"],
      ],
      ["should reject malformed --field values", ["-f", "no-equals"]],
      ["should reject empty dotted segments in --field key", ["-f", "a..b=x"]],
    ] as const)("%s", async (_name, args) => {
      const result = await runCommand(apiCommand, ["GetFunctionExecution", ...args]);

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

      const body = getRequestBody();
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

      const body = getRequestBody();
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
