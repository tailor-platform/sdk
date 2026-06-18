import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import { getFunctionRegistry } from "./get";

vi.mock("#/cli/shared/context", () => ({
  loadAccessToken: vi.fn(),
  loadWorkspaceId: vi.fn(),
}));

vi.mock("#/cli/shared/client", () => ({
  initOperatorClient: vi.fn(),
}));

describe("getFunctionRegistry", () => {
  let getFunctionRegistryMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadAccessToken).mockResolvedValue("mock-token");
    vi.mocked(loadWorkspaceId).mockResolvedValue("workspace-1");
    getFunctionRegistryMock = vi.fn();
    vi.mocked(initOperatorClient).mockResolvedValue({
      getFunctionRegistry: getFunctionRegistryMock,
    } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);
  });

  test("returns transformed FunctionRegistryInfo on success", async () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");
    const updatedAt = new Date("2026-02-01T00:00:00Z");
    getFunctionRegistryMock.mockResolvedValue({
      function: {
        name: "my-fn",
        description: "desc",
        sizeBytes: 1024n,
        contentHash: "abc123",
        createdAt: timestampFromDate(createdAt),
        updatedAt: timestampFromDate(updatedAt),
      },
    });

    const info = await getFunctionRegistry({ name: "my-fn" });

    expect(info).toEqual({
      name: "my-fn",
      description: "desc",
      sizeBytes: "1024",
      contentHash: "abc123",
      createdAt,
      updatedAt,
    });
    expect(getFunctionRegistryMock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      name: "my-fn",
    });
  });

  test("throws friendly message when ConnectError NotFound is raised", async () => {
    getFunctionRegistryMock.mockRejectedValue(new ConnectError("gone", Code.NotFound));

    await expect(getFunctionRegistry({ name: "missing" })).rejects.toThrow(
      'Function registry "missing" not found.',
    );
  });

  test("throws not-found when response.function is missing", async () => {
    getFunctionRegistryMock.mockResolvedValue({ function: undefined });

    await expect(getFunctionRegistry({ name: "ghost" })).rejects.toThrow(
      'Function registry "ghost" not found.',
    );
  });
});
