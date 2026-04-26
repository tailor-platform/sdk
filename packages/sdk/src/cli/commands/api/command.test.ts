import { runCommand } from "politty";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { loadConfig } from "@/cli/shared/config-loader";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { logger } from "@/cli/shared/logger";
import { apiCommand } from "./index";

vi.mock("@/cli/shared/context", () => ({
  loadAccessToken: vi.fn(),
  loadWorkspaceId: vi.fn(),
}));

vi.mock("@/cli/shared/config-loader", () => ({
  loadConfig: vi.fn(),
}));

const fetchMock = vi.fn();

describe("api --list", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    fetchMock.mockReset();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  test("emits method names line by line and does not call fetch", async () => {
    vi.stubGlobal("fetch", fetchMock);
    try {
      await runCommand(apiCommand, ["--list"]);
    } finally {
      vi.unstubAllGlobals();
    }
    const written = stdoutSpy.mock.calls.map((c: [unknown]) => String(c[0])).join("");
    expect(written).toContain("Ping\n");
    expect(written).toContain("GetApplication\n");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("with jsonMode emits JSON array of method names", async () => {
    const original = logger.jsonMode;
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.jsonMode = true;
    try {
      await runCommand(apiCommand, ["--list"]);
      const calls = consoleLogSpy.mock.calls.map((c) => String(c[0]));
      const json = calls.find((line) => line.startsWith("["));
      expect(json).toBeDefined();
      const parsed = JSON.parse(json ?? "[]");
      expect(parsed).toContain("Ping");
      expect(parsed).toContain("GetApplication");
    } finally {
      consoleLogSpy.mockRestore();
      logger.jsonMode = original;
    }
  });
});

describe("api --inspect", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    fetchMock.mockReset();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  test("prints field tree as text and does not call fetch", async () => {
    vi.stubGlobal("fetch", fetchMock);
    try {
      await runCommand(apiCommand, ["GetApplication", "--inspect"]);
    } finally {
      vi.unstubAllGlobals();
    }
    const written = stdoutSpy.mock.calls.map((c: [unknown]) => String(c[0])).join("");
    expect(written).toContain("GetApplication");
    expect(written).toContain("workspaceId");
    expect(written).toContain("applicationName");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("with jsonMode emits structured method descriptor", async () => {
    const original = logger.jsonMode;
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.jsonMode = true;
    try {
      await runCommand(apiCommand, ["GetApplication", "--inspect"]);
      const calls = consoleLogSpy.mock.calls.map((c) => String(c[0]));
      const json = calls.find((line) => line.startsWith("{"));
      expect(json).toBeDefined();
      const parsed = JSON.parse(json ?? "{}");
      expect(parsed.method).toBe("GetApplication");
      const names = parsed.input.fields.map((f: { name: string }) => f.name);
      expect(names).toContain("workspaceId");
    } finally {
      consoleLogSpy.mockRestore();
      logger.jsonMode = original;
    }
  });

  test("rejects unknown method", async () => {
    const result = await runCommand(apiCommand, ["NotARealMethod", "--inspect"]);
    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/unknown method/);
  });
});

describe("api --field", () => {
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

  test("merges single field into request body", async () => {
    vi.mocked(loadWorkspaceId).mockRejectedValue(new Error("not found"));
    await runCommand(apiCommand, ["GetApplication", "--field", "applicationName=app1"]);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.applicationName).toBe("app1");
  });

  test("supports short alias -f and merges multiple fields", async () => {
    vi.mocked(loadWorkspaceId).mockRejectedValue(new Error("not found"));
    await runCommand(apiCommand, [
      "GetApplication",
      "-f",
      "workspaceId=ws-1",
      "-f",
      "applicationName=app2",
    ]);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ workspaceId: "ws-1", applicationName: "app2" });
  });

  test("auto-injects workspaceId when --field omits it", async () => {
    vi.mocked(loadWorkspaceId).mockResolvedValue("auto-ws");
    await runCommand(apiCommand, ["GetApplication", "-f", "applicationName=app1"]);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ applicationName: "app1", workspaceId: "auto-ws" });
  });

  test("--field overrides --body for the same key", async () => {
    vi.mocked(loadWorkspaceId).mockRejectedValue(new Error("not found"));
    await runCommand(apiCommand, [
      "GetApplication",
      "-b",
      '{"applicationName":"old"}',
      "-f",
      "applicationName=new",
    ]);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.applicationName).toBe("new");
  });

  test("supports dot-notation for nested message", async () => {
    vi.mocked(loadWorkspaceId).mockRejectedValue(new Error("not found"));
    await runCommand(apiCommand, ["CreateTailorDBType", "-f", "tailordbType.name=User"]);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.tailordbType).toEqual({ name: "User" });
  });

  test("collects repeated values into array", async () => {
    vi.mocked(loadWorkspaceId).mockRejectedValue(new Error("not found"));
    await runCommand(apiCommand, [
      "CreateApplication",
      "-f",
      "cors=https://a",
      "-f",
      "cors=https://b",
    ]);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.cors).toEqual(["https://a", "https://b"]);
  });

  test("surfaces merge errors as CLIError", async () => {
    const result = await runCommand(apiCommand, ["GetApplication", "-f", "fooBar=x"]);
    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/--field|unknown field/);
  });
});

describe("api endpoint required check", () => {
  test("rejects missing endpoint when --list not given", async () => {
    const result = await runCommand(apiCommand, []);
    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/endpoint is required/);
  });
});

// silence external loadConfig path
vi.mocked(loadConfig).mockRejectedValue(new Error("no config"));
