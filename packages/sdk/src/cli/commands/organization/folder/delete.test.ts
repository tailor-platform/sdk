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
  vi.mocked(initOperatorClient).mockResolvedValue({
    getOrganizationFolder: vi.fn().mockResolvedValue({ folder: { name: "docs" } }),
    deleteOrganizationFolder: vi.fn().mockResolvedValue({}),
    ...overrides,
  } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);
}

describe("organization folder delete", () => {
  aroundEach(async (runTest) => {
    vi.clearAllMocks();
    await runTest();
  });

  test("deletes the folder after the existence check succeeds", async () => {
    const deleteOrganizationFolder = vi.fn().mockResolvedValue({});
    mockClient({ deleteOrganizationFolder });

    const result = await runCommand(deleteCommand, argv);

    expect(result.error).toBeUndefined();
    expect(deleteOrganizationFolder).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      folderId: FOLDER_ID,
    });
    expect(logger.success).toHaveBeenCalledWith('Folder "docs" deleted successfully.');
  });

  test("reports not found when the folder lookup returns NotFound", async () => {
    const deleteOrganizationFolder = vi.fn().mockResolvedValue({});
    mockClient({
      getOrganizationFolder: vi.fn().mockRejectedValue(new ConnectError("missing", Code.NotFound)),
      deleteOrganizationFolder,
    });

    const result = await runCommand(deleteCommand, argv);

    expect(result.error?.message).toBe(`Folder "${FOLDER_ID}" not found.`);
    expect(deleteOrganizationFolder).not.toHaveBeenCalled();
  });

  test("propagates lookup failures other than NotFound", async () => {
    const failure = new ConnectError("backend unavailable", Code.Unavailable);
    const deleteOrganizationFolder = vi.fn().mockResolvedValue({});
    mockClient({
      getOrganizationFolder: vi.fn().mockRejectedValue(failure),
      deleteOrganizationFolder,
    });

    const result = await runCommand(deleteCommand, argv);

    expect(result.error).toBe(failure);
    expect(deleteOrganizationFolder).not.toHaveBeenCalled();
  });
});
