import { runCommand } from "politty";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { seedApplyCommand } from "./apply";
import { commonArgs } from "./shared/args";

const sdk = vi.hoisted(() => ({
  bundleSeedScript: vi.fn(),
  chunkSeedData: vi.fn(),
  executeScript: vi.fn(),
  initOperatorClient: vi.fn(),
  loadAccessToken: vi.fn(),
  loadSeedContext: vi.fn(),
  loadWorkspaceId: vi.fn(),
  show: vi.fn(),
  truncate: vi.fn(),
}));

const jsonl = vi.hoisted(() => ({
  assertSeedDataDirectory: vi.fn(),
  loadSeedData: vi.fn(),
}));

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  newline: vi.fn(),
  out: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@tailor-platform/sdk/cli", () => sdk);
vi.mock("./jsonl", () => jsonl);
vi.mock("./shared/logger", () => ({ logger }));

beforeEach(() => {
  vi.resetAllMocks();
  sdk.loadSeedContext.mockResolvedValue({
    config: { path: "/workspace/tailor.config.ts" },
    distPath: "/seed",
    idpUser: {
      seedScriptCode: "seed-user-code",
      truncateScriptCode: "truncate-user-code",
    },
    machineUserName: undefined,
    namespaces: [
      {
        dependencies: { User: [] },
        namespace: "tailordb",
        selfRefTypes: [],
        types: ["User"],
      },
    ],
  });
  sdk.show.mockResolvedValue({ auth: "auth" });
  sdk.loadAccessToken.mockResolvedValue("token");
  sdk.loadWorkspaceId.mockResolvedValue("workspace-id");
  sdk.initOperatorClient.mockReturnValue({});
  sdk.truncate.mockResolvedValue(undefined);
  sdk.executeScript.mockImplementation(({ name }: { name: string }) =>
    Promise.resolve({
      error: undefined,
      logs: "",
      result:
        name === "truncate-idp-user.ts"
          ? '{"success":true,"deleted":1}'
          : '{"success":true,"processed":1}',
      success: true,
    }),
  );
  jsonl.loadSeedData.mockImplementation((_dataDir: string, typeNames: string[]) =>
    Object.fromEntries(
      typeNames.map((typeName) => [typeName, typeName === "_User" ? [{ name: "Ada" }] : []]),
    ),
  );
});

function runApplyCommand(args: string[]) {
  return runCommand(seedApplyCommand, args, {
    // Strip unknown global arguments like the plugin entrypoint.
    globalArgs: z.object(commonArgs),
  });
}

async function runApply(args: string[]): Promise<void> {
  const result = await runApplyCommand(["--machine-user", "manager", ...args]);
  expect(result.exitCode).toBe(0);
}

describe("seedApplyCommand", () => {
  test("rejects a missing generated data directory before remote operations", async () => {
    jsonl.assertSeedDataDirectory.mockImplementationOnce(() => {
      throw new Error("Seed data directory not found: /seed/data");
    });

    const result = await runApplyCommand(["--machine-user", "manager", "--truncate", "--yes"]);

    expect(result.exitCode).toBe(1);
    expect(jsonl.assertSeedDataDirectory).toHaveBeenCalledWith("/seed/data");
    expect(sdk.show).not.toHaveBeenCalled();
    expect(sdk.loadAccessToken).not.toHaveBeenCalled();
    expect(sdk.loadWorkspaceId).not.toHaveBeenCalled();
    expect(sdk.truncate).not.toHaveBeenCalled();
    expect(sdk.executeScript).not.toHaveBeenCalled();
  });

  test("succeeds without remote operations when the project has no seed targets", async () => {
    sdk.loadSeedContext.mockResolvedValueOnce({
      distPath: "/seed",
      idpUser: null,
      machineUserName: undefined,
      namespaces: [],
    });

    const result = await runApplyCommand(["--truncate", "--yes", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(logger.out).toHaveBeenCalledWith({ success: true, processed: {} });
    expect(logger.success).toHaveBeenCalledWith("No seed targets found.");
    expect(sdk.show).not.toHaveBeenCalled();
    expect(sdk.loadAccessToken).not.toHaveBeenCalled();
    expect(sdk.loadWorkspaceId).not.toHaveBeenCalled();
    expect(sdk.initOperatorClient).not.toHaveBeenCalled();
    expect(sdk.truncate).not.toHaveBeenCalled();
    expect(sdk.executeScript).not.toHaveBeenCalled();
    expect(jsonl.assertSeedDataDirectory).not.toHaveBeenCalled();
    expect(jsonl.loadSeedData).not.toHaveBeenCalled();
  });

  test("succeeds without remote operations when --skip-idp removes the only target", async () => {
    sdk.loadSeedContext.mockResolvedValueOnce({
      distPath: "/seed",
      idpUser: {
        seedScriptCode: "seed-user-code",
        truncateScriptCode: "truncate-user-code",
      },
      machineUserName: undefined,
      namespaces: [],
    });

    const result = await runApplyCommand([
      "--machine-user",
      "manager",
      "--skip-idp",
      "--truncate",
      "--yes",
    ]);

    expect(result.exitCode).toBe(0);
    expect(logger.success).toHaveBeenCalledWith("No seed targets found.");
    expect(sdk.show).not.toHaveBeenCalled();
    expect(sdk.loadAccessToken).not.toHaveBeenCalled();
    expect(sdk.loadWorkspaceId).not.toHaveBeenCalled();
    expect(sdk.initOperatorClient).not.toHaveBeenCalled();
    expect(sdk.truncate).not.toHaveBeenCalled();
    expect(sdk.executeScript).not.toHaveBeenCalled();
  });

  test("truncates all TailorDB data and the IdP user before seeding by default", async () => {
    await runApply(["--truncate", "--yes"]);

    expect(sdk.truncate).toHaveBeenCalledWith({
      all: true,
      configPath: "tailor.config.ts",
      profile: undefined,
      workspaceId: undefined,
    });
    expect(sdk.executeScript).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ name: "truncate-idp-user.ts" }),
    );
    expect(sdk.executeScript).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ name: "seed-idp-user.ts" }),
    );
  });

  test("limits truncation to a namespace and excludes the IdP user", async () => {
    await runApply(["--truncate", "--yes", "--namespace", "tailordb"]);

    expect(sdk.truncate).toHaveBeenCalledWith({
      configPath: "tailor.config.ts",
      namespace: "tailordb",
      profile: undefined,
      workspaceId: undefined,
    });
    expect(sdk.executeScript).not.toHaveBeenCalled();
  });

  test("limits truncation to selected TailorDB types and excludes the IdP user", async () => {
    await runApply(["--truncate", "--yes", "User"]);

    expect(sdk.truncate).toHaveBeenCalledWith({
      configPath: "tailor.config.ts",
      profile: undefined,
      types: ["User"],
      workspaceId: undefined,
    });
    expect(sdk.executeScript).not.toHaveBeenCalled();
  });

  test("truncates and seeds only the IdP user when it is the selected type", async () => {
    await runApply(["--truncate", "--yes", "_User"]);

    expect(sdk.truncate).not.toHaveBeenCalled();
    expect(sdk.executeScript).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ name: "truncate-idp-user.ts" }),
    );
    expect(sdk.executeScript).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ name: "seed-idp-user.ts" }),
    );
  });

  test("skips IdP user truncation and seeding with --skip-idp", async () => {
    await runApply(["--truncate", "--yes", "--skip-idp"]);

    expect(sdk.truncate).toHaveBeenCalledWith(expect.objectContaining({ all: true }));
    expect(sdk.executeScript).not.toHaveBeenCalled();
  });
});
