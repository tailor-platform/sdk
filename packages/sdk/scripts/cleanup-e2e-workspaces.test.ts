import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { deleteWorkspace, listWorkspaces } = vi.hoisted(() => ({
  deleteWorkspace: vi.fn(),
  listWorkspaces: vi.fn(),
}));

vi.mock("../src/cli/shared/client", () => ({
  initOperatorClient: vi.fn(() => ({ deleteWorkspace, listWorkspaces })),
}));
vi.mock("../src/cli/shared/context", () => ({
  loadAccessToken: vi.fn(() => Promise.resolve("test-token")),
}));

describe("cleanup-e2e-workspaces", () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    vi.resetModules();
    process.argv = ["node", "cleanup-e2e-workspaces.ts", "--run-id=123"];
    listWorkspaces.mockResolvedValue({
      nextPageToken: undefined,
      workspaces: [
        { id: "failed-id", name: "e2e-ws-123-failed" },
        { id: "deleted-id", name: "e2e-ws-123-deleted" },
      ],
    });
    deleteWorkspace.mockRejectedValueOnce(new Error("delete failed")).mockResolvedValueOnce({});
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
  });

  test("exits unsuccessfully after any workspace deletion fails", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await import("./cleanup-e2e-workspaces");

    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(1));
    expect(deleteWorkspace).toHaveBeenCalledTimes(2);
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("✅ Cleanup complete"));
  });
});
