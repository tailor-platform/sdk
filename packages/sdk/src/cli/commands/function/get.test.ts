import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import { mockOperatorClient } from "#/cli/shared/test-helpers/operator-client";
import { getFunctionRegistry } from "./get";

vi.mock("#/cli/shared/context", () => ({
  loadAccessToken: vi.fn(),
  loadWorkspaceId: vi.fn(),
}));

vi.mock("#/cli/shared/client", () => ({
  initOperatorClient: vi.fn(),
}));

function createClient() {
  return mockOperatorClient({ getFunctionRegistry: {} });
}

describe("getFunctionRegistry", () => {
  let client: ReturnType<typeof createClient>;

  aroundEach(async (runTest) => {
    vi.mocked(loadAccessToken).mockResolvedValue("mock-token");
    vi.mocked(loadWorkspaceId).mockResolvedValue("workspace-1");
    client = createClient();
    vi.mocked(initOperatorClient).mockResolvedValue(client);
    await runTest();
  });

  test("returns transformed FunctionRegistryInfo on success", async () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");
    const updatedAt = new Date("2026-02-01T00:00:00Z");
    client.getFunctionRegistry.mockResolvedValue({
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
    expect(client.getFunctionRegistry).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      name: "my-fn",
    });
  });

  test("throws friendly message when ConnectError NotFound is raised", async () => {
    client.getFunctionRegistry.mockRejectedValue(new ConnectError("gone", Code.NotFound));

    await expect(getFunctionRegistry({ name: "missing" })).rejects.toThrow(
      'Function registry "missing" not found.',
    );
  });

  test("throws not-found when response.function is missing", async () => {
    client.getFunctionRegistry.mockResolvedValue({ function: undefined });

    await expect(getFunctionRegistry({ name: "ghost" })).rejects.toThrow(
      'Function registry "ghost" not found.',
    );
  });
});
