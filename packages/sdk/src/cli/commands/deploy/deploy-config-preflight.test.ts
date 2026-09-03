import { aroundEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureConfigIdForDeploy: vi.fn(),
  loadConfig: vi.fn(),
  resolveDeployWorkspace: vi.fn(),
  warnMissingAppId: vi.fn(),
}));

vi.mock("#/cli/shared/config-loader", () => ({
  loadConfig: mocks.loadConfig,
}));

vi.mock("./config-id-injector", () => ({
  ensureConfigIdForDeploy: mocks.ensureConfigIdForDeploy,
  warnMissingAppId: mocks.warnMissingAppId,
}));

vi.mock("./workspace", () => ({
  resolveDeployWorkspace: mocks.resolveDeployWorkspace,
}));

import { deploy } from "./deploy";

const firstConfigPath = "src/cli/commands/deploy/__test_fixtures__/tailor.config.ts";
const secondConfigPath = "src/cli/commands/deploy/__test_fixtures__/single-evaluation.config.ts";

describe("multi-config deploy preflight", () => {
  aroundEach(async (runTest) => {
    vi.clearAllMocks();
    await runTest();
  });

  test("waits for every config ID preparation before importing any config", async () => {
    const firstPrepared = Promise.withResolvers<void>();
    const secondPrepared = Promise.withResolvers<void>();
    mocks.ensureConfigIdForDeploy.mockImplementation(({ configPath }: { configPath: string }) =>
      configPath.endsWith(firstConfigPath) ? firstPrepared.promise : secondPrepared.promise,
    );
    mocks.loadConfig.mockImplementation(async (configPath: string) => ({
      config: {
        id: "11111111-1111-4111-8111-111111111111",
        name: configPath,
        path: configPath,
      },
      plugins: [],
    }));
    const workspaceError = new Error("workspace resolution stopped deploy");
    mocks.resolveDeployWorkspace.mockRejectedValue(workspaceError);

    const deployment = deploy({ configPath: `${firstConfigPath},${secondConfigPath}` });

    await vi.waitFor(() => expect(mocks.ensureConfigIdForDeploy).toHaveBeenCalledTimes(2));
    firstPrepared.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(mocks.loadConfig).not.toHaveBeenCalled();

    secondPrepared.resolve();
    await expect(deployment).rejects.toBe(workspaceError);
    expect(mocks.loadConfig).toHaveBeenCalledTimes(2);
  });
});
