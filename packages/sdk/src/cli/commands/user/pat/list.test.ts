import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { PATScope } from "@tailor-platform/tailor-proto/auth_resource_pb";
import { runCommand } from "politty";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import { fetchLatestToken, readPlatformConfig } from "#/cli/shared/context";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { listCommand } from "./list";

vi.mock("#/cli/shared/client", async (importOriginal) => ({
  ...(await importOriginal()),
  initOperatorClient: vi.fn(),
}));

vi.mock("#/cli/shared/context", async (importOriginal) => ({
  ...(await importOriginal()),
  fetchLatestToken: vi.fn(),
  readPlatformConfig: vi.fn(),
}));

const baseConfig = {
  version: 3,
  min_sdk_version: "2.0.0",
  users: {},
  profiles: {
    dev: {
      user: "u@example.com",
      workspace_id: "12345678-1234-4abc-8def-123456789012",
      platform_url: "https://api.dev.tailor.tech",
    },
  },
  current_user: null,
} satisfies Awaited<ReturnType<typeof readPlatformConfig>>;

describe("user pat list", () => {
  aroundEach(async (runTest) => {
    vi.stubEnv("TAILOR_PLATFORM_PROFILE", "dev");
    vi.clearAllMocks();
    vi.mocked(fetchLatestToken).mockResolvedValue({
      accessToken: "scoped-token",
      user: "u@example.com",
    });
    vi.mocked(initOperatorClient).mockResolvedValue({
      listPersonalAccessTokens: vi.fn().mockResolvedValue({
        personalAccessTokens: [],
        nextPageToken: "",
      }),
    } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);
    await runTest();
    vi.unstubAllEnvs();
  });

  test("uses the active profile platform when loading the current user's token", async () => {
    vi.mocked(readPlatformConfig).mockResolvedValue(baseConfig);
    using _json = jsonMode();

    const result = await runCommand(listCommand, []);

    expect(result.success).toBe(true);
    expect(fetchLatestToken).toHaveBeenCalledWith(baseConfig, "u@example.com", {
      platformUrl: "https://api.dev.tailor.tech",
    });
    expect(initOperatorClient).toHaveBeenCalledWith("scoped-token", {
      platformUrl: "https://api.dev.tailor.tech",
    });
  });

  test("renders scopes, usage timestamps, and a never-used token as never", async () => {
    const createdAt = new Date("2026-01-02T03:04:05Z");
    const lastUsedAt = new Date("2026-03-04T05:06:07Z");
    vi.mocked(readPlatformConfig).mockResolvedValue(baseConfig);
    vi.mocked(initOperatorClient).mockResolvedValue({
      listPersonalAccessTokens: vi.fn().mockResolvedValue({
        personalAccessTokens: [
          {
            name: "used",
            scopes: [PATScope.PAT_SCOPE_READ, PATScope.PAT_SCOPE_WRITE],
            createdAt: timestampFromDate(createdAt),
            lastUsedAt: timestampFromDate(lastUsedAt),
          },
          {
            name: "unused",
            scopes: [PATScope.PAT_SCOPE_READ],
            createdAt: timestampFromDate(createdAt),
          },
        ],
        nextPageToken: "",
      }),
    } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);
    const chunks: string[] = [];
    using _stdout = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      chunks.push(String(chunk));
      return true;
    });

    const result = await runCommand(listCommand, []);

    expect(result.success).toBe(true);
    const rows = chunks
      .join("")
      .split("\n")
      .filter((line) => line.startsWith("\u2502"))
      .map((line) =>
        line
          .split("\u2502")
          .slice(1, -1)
          .map((cell) => cell.trim()),
      );
    expect(rows).toEqual([
      ["name", "scopes", "createdAt", "lastUsedAt"],
      ["used", "read/write", expect.stringContaining("ago"), expect.stringContaining("ago")],
      ["unused", "read", expect.stringContaining("ago"), "never"],
    ]);
  });

  test("keeps usage timestamps as dates in JSON mode", async () => {
    const createdAt = new Date("2026-01-02T03:04:05Z");
    vi.mocked(readPlatformConfig).mockResolvedValue(baseConfig);
    vi.mocked(initOperatorClient).mockResolvedValue({
      listPersonalAccessTokens: vi.fn().mockResolvedValue({
        personalAccessTokens: [
          {
            name: "unused",
            scopes: [PATScope.PAT_SCOPE_READ],
            createdAt: timestampFromDate(createdAt),
          },
        ],
        nextPageToken: "",
      }),
    } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);
    using _json = jsonMode();
    using logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await runCommand(listCommand, []);

    expect(result.success).toBe(true);
    expect(JSON.parse(logSpy.mock.calls[0]?.[0] as string)).toEqual([
      {
        name: "unused",
        scopes: ["read"],
        createdAt: createdAt.toISOString(),
        lastUsedAt: null,
      },
    ]);
  });
});
