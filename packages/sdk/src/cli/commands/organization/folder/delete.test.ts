import { Code, ConnectError } from "@connectrpc/connect";
import { runCommand } from "@politty/zod";
import { describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import { logger } from "#/cli/shared/logger";
import { prompt } from "#/cli/shared/prompt";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import {
  mockOperatorClient,
  type OperatorClientMocks,
  withOperatorClientMocks,
} from "#/cli/shared/test-helpers/operator-client";
import { deleteCommand } from "./delete";
import type { OperatorClient } from "#/cli/shared/client";

vi.mock("#/cli/shared/context", () => ({
  loadAccessToken: vi.fn().mockResolvedValue("mock-token"),
}));

vi.mock("#/cli/shared/readonly-guard", () => ({
  assertWritable: vi.fn(),
}));

vi.mock("#/cli/shared/client", () => ({
  initOperatorClient: vi.fn(),
}));

vi.mock("#/cli/shared/prompt", () => ({
  prompt: {
    confirm: vi.fn(),
  },
}));

vi.mock("#/cli/shared/logger", async (importOriginal) => ({
  ...(await importOriginal()),
  logger: {
    success: vi.fn(),
    info: vi.fn(),
    out: vi.fn(),
    jsonMode: false,
  },
}));

const ORGANIZATION_ID = "11111111-1111-1111-1111-111111111111";
const FOLDER_ID = "22222222-2222-2222-2222-222222222222";

const argv = ["--organization-id", ORGANIZATION_ID, "--folder-id", FOLDER_ID, "--yes"];

function mockClient<K extends keyof OperatorClient = never>(overrides?: OperatorClientMocks<K>) {
  const client = withOperatorClientMocks(
    mockOperatorClient({
      getOrganizationFolder: { folder: { name: "docs" } },
      deleteOrganizationFolder: {},
    }),
    overrides,
  );
  vi.mocked(initOperatorClient).mockResolvedValue(client);
  return client;
}

describe("organization folder delete", () => {
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
      getOrganizationFolder: {},
    });

    const result = await runCommand(deleteCommand, argv);

    expect(result.error?.message).toBe(`Folder "${FOLDER_ID}" not found.`);
    expect(client.deleteOrganizationFolder).not.toHaveBeenCalled();
  });

  test("reports not found when the lookup fails with NotFound", async () => {
    const failure = new ConnectError("folder missing", Code.NotFound);
    const client = mockClient({
      getOrganizationFolder: () => Promise.reject(failure),
    });

    const result = await runCommand(deleteCommand, argv);

    expect(result.error?.message).toBe(`Folder "${FOLDER_ID}" not found.`);
    expect(result.error?.cause).toBe(failure);
    expect(client.deleteOrganizationFolder).not.toHaveBeenCalled();
  });

  test("deletes when the confirmation is accepted", async () => {
    const client = mockClient({});
    vi.mocked(prompt.confirm).mockResolvedValue(true);

    const result = await runCommand(deleteCommand, argv.slice(0, -1));

    expect(result.success).toBe(true);
    expect(client.deleteOrganizationFolder).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      folderId: FOLDER_ID,
    });
  });

  test("fails without deleting when the confirmation is declined", async () => {
    const client = mockClient({});
    vi.mocked(prompt.confirm).mockResolvedValue(false);

    const result = await runCommand(deleteCommand, argv.slice(0, -1));

    expect(prompt.confirm).toHaveBeenCalledWith({
      message: 'Are you sure you want to delete folder "docs"?',
    });
    expect(result.error).toMatchObject({ code: "FOLDER_DELETION_CANCELLED" });
    expect(client.deleteOrganizationFolder).not.toHaveBeenCalled();
  });

  test("propagates lookup failures other than NotFound", async () => {
    const failure = new ConnectError("backend unavailable", Code.Unavailable);
    const client = mockClient({
      getOrganizationFolder: () => Promise.reject(failure),
    });

    const result = await runCommand(deleteCommand, argv);

    expect(result.error).toBe(failure);
    expect(client.deleteOrganizationFolder).not.toHaveBeenCalled();
  });

  test("prints the deleted folder under JSON output", async () => {
    mockClient({});
    using _json = jsonMode();

    const result = await runCommand(deleteCommand, argv);

    expect(result.error).toBeUndefined();
    expect(logger.out).toHaveBeenCalledWith({
      changed: true,
      organizationId: ORGANIZATION_ID,
      folderId: FOLDER_ID,
      name: "docs",
    });
  });
});
