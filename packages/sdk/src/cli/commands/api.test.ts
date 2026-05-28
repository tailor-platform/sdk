import { runCommand } from "politty";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { loadConfig } from "@/cli/shared/config-loader";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { logger } from "@/cli/shared/logger";
import { apiCommand } from "./api";

vi.mock("@/cli/shared/context", () => ({
  loadAccessToken: vi.fn(),
  loadWorkspaceId: vi.fn(),
}));

vi.mock("@/cli/shared/config-loader", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("@/cli/shared/readonly-guard", () => ({
  assertWritable: vi.fn(),
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
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: "ok", value: 42 }),
      });

      const original = logger.jsonMode;
      logger.jsonMode = true;
      try {
        await runCommand(apiCommand, ["Ping"]);
        const stdoutContent = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
        const consoleContent = consoleLogSpy.mock.calls.map((c) => String(c[0])).join("");
        const allStdout = stdoutContent + consoleContent;
        const stderrContent = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
        expect(allStdout).toContain('"result"');
        expect(allStdout).toContain('"ok"');
        expect(stderrContent).not.toContain('"result"');
      } finally {
        logger.jsonMode = original;
      }
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
});
