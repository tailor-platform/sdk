import { Code, ConnectError } from "@connectrpc/connect";
import { runCommand } from "politty";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import { logger } from "#/cli/shared/logger";
import { deleteCommand } from "./delete";

vi.mock("#/cli/shared/context", () => ({
  loadAccessToken: vi.fn().mockResolvedValue("mock-token"),
}));

vi.mock("#/cli/shared/readonly-guard", () => ({
  assertWritable: vi.fn(),
}));

vi.mock("#/cli/shared/client", () => ({
  initOperatorClient: vi.fn(),
}));

vi.mock("#/cli/shared/logger", () => ({
  logger: {
    success: vi.fn(),
    info: vi.fn(),
  },
}));

const ORGANIZATION_ID = "11111111-1111-1111-1111-111111111111";
const FOLDER_ID = "22222222-2222-2222-2222-222222222222";

const argv = ["--organization-id", ORGANIZATION_ID, "--folder-id", FOLDER_ID, "--yes"];

function mockClient(overrides: Record<string, unknown>) {
  const client = {
    getOrganizationFolder: vi.fn().mockResolvedValue({ folder: { name: "docs" } }),
    deleteOrganizationFolder: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
  vi.mocked(initOperatorClient).mockResolvedValue(
    client as unknown as Awaited<ReturnType<typeof initOperatorClient>>,
  );
  return client;
}

describe("organization folder delete", () => {
  aroundEach(async (runTest) => {
    vi.clearAllMocks();
    await runTest();
  });

  test("deletes the folder after the existence check succeeds", async () => {
    const client = mockClient({});

    const result = await runCommand(deleteCommand, argv);

    expect(result.error).toBeUndefined();
    expect(client.deleteOrganizationFolder).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      folderId: FOLDER_ID,
    });
    expect(logger.success).toHaveBeenCalledWith('Folder "docs" deleted successfully.');
  });

  test("reports not found when the lookup succeeds without a folder", async () => {
    const client = mockClient({
      getOrganizationFolder: vi.fn().mockResolvedValue({}),
    });

    const result = await runCommand(deleteCommand, argv);

    expect(result.error?.message).toBe(`Folder "${FOLDER_ID}" not found.`);
    expect(client.deleteOrganizationFolder).not.toHaveBeenCalled();
  });

  test.each([
    ["NotFound (missing organization)", new ConnectError("org missing", Code.NotFound)],
    ["Unavailable", new ConnectError("backend unavailable", Code.Unavailable)],
  ])("propagates lookup failures: %s", async (_name, failure) => {
    const client = mockClient({
      getOrganizationFolder: vi.fn().mockRejectedValue(failure),
    });

    const result = await runCommand(deleteCommand, argv);

    expect(result.error).toBe(failure);
    expect(client.deleteOrganizationFolder).not.toHaveBeenCalled();
  });
});
