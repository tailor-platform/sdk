import { aroundEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveDeployWorkspace: vi.fn(),
  withDeployLock: vi.fn(),
  createMetadataLookupClient: vi.fn(),
}));

vi.mock("./workspace", () => ({
  resolveDeployWorkspace: mocks.resolveDeployWorkspace,
}));
vi.mock("./deploy-lock", () => ({
  withDeployLock: mocks.withDeployLock,
}));
vi.mock("./metadata-lookup", () => ({
  createMetadataLookupClient: mocks.createMetadataLookupClient,
}));

import { deploy } from "./deploy";

const configPath = "src/cli/commands/deploy/__test_fixtures__/tailor.config.ts";
const workspace = { client: {}, workspaceId: "11111111-1111-4111-8111-111111111111" };

describe("deploy lock wiring", () => {
  aroundEach(async (runTest) => {
    vi.clearAllMocks();
    mocks.resolveDeployWorkspace.mockResolvedValue(workspace);
    mocks.createMetadataLookupClient.mockRejectedValue(new Error("planning started"));
    await runTest();
  });

  test("takes the application lock before planning against remote state", async () => {
    const lockError = new Error("lock held elsewhere");
    mocks.withDeployLock.mockRejectedValue(lockError);

    await expect(deploy({ configPath, yes: true })).rejects.toBe(lockError);

    expect(mocks.withDeployLock).toHaveBeenCalledWith(
      {
        client: workspace.client,
        workspaceId: workspace.workspaceId,
        applications: [{ name: "test-app", id: "47eb65f3-2de9-4279-883f-2db54815ae8a" }],
      },
      expect.any(Function),
    );
    expect(mocks.createMetadataLookupClient).not.toHaveBeenCalled();
  });

  test("plans and applies inside the locked section", async () => {
    mocks.withDeployLock.mockImplementation(
      async (_options: unknown, fn: (lock: { assertHeld(): void }) => Promise<unknown>) =>
        fn({ assertHeld: () => {} }),
    );

    await expect(deploy({ configPath, yes: true })).rejects.toThrow("planning started");
    expect(mocks.createMetadataLookupClient).toHaveBeenCalledOnce();
  });

  test("does not lock a dry run", async () => {
    await expect(deploy({ configPath, dryRun: true })).rejects.toThrow("planning started");

    expect(mocks.withDeployLock).not.toHaveBeenCalled();
  });
});
