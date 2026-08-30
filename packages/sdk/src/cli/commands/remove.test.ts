import { runCommand } from "politty";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { withDeployLock } from "#/cli/commands/deploy/deploy-lock";
import { initOperatorClient } from "#/cli/shared/client";
import { logger } from "#/cli/shared/logger";
import { removeCommand } from "./remove";

const mocks = vi.hoisted(() => {
  const changeSet = () => ({
    creates: [],
    updates: [],
    deletes: [],
    replaces: [],
    unchanged: [],
    isEmpty: () => true,
    lines: () => [],
  });
  const ownership = () => ({ conflicts: [], unmanaged: [], resourceOwners: new Set<string>() });

  return {
    changeSet,
    ownership,
    planAIGateway: vi.fn(async () => ({ changeSet: changeSet(), ...ownership() })),
    applyAIGateway: vi.fn(),
    planApplication: vi.fn(async () => changeSet()),
    applyApplication: vi.fn(),
    planAuth: vi.fn(async () => ({
      changeSet: {
        service: changeSet(),
        idpConfig: changeSet(),
        userProfileConfig: changeSet(),
        tenantConfig: changeSet(),
        machineUser: changeSet(),
        oauth2Client: changeSet(),
        authHook: changeSet(),
        scim: changeSet(),
        scimResource: changeSet(),
        connection: changeSet(),
      },
      ...ownership(),
    })),
    applyAuth: vi.fn(),
    planExecutor: vi.fn(async () => ({ changeSet: changeSet(), ...ownership() })),
    applyExecutor: vi.fn(),
    planFunctionRegistry: vi.fn(async () => ({ changeSet: changeSet(), ...ownership() })),
    applyFunctionRegistry: vi.fn(),
    planIdP: vi.fn(async () => ({
      changeSet: { service: changeSet(), client: changeSet() },
      ...ownership(),
    })),
    applyIdP: vi.fn(),
    planPipeline: vi.fn(async () => ({
      changeSet: { service: changeSet(), resolver: changeSet() },
      ...ownership(),
    })),
    applyPipeline: vi.fn(),
    planSecretManager: vi.fn(async () => ({
      vaultChangeSet: changeSet(),
      secretChangeSet: changeSet(),
      ...ownership(),
    })),
    applySecretManager: vi.fn(),
    planStaticWebsite: vi.fn(async () => ({ changeSet: changeSet(), ...ownership() })),
    applyStaticWebsite: vi.fn(),
    planTailorDB: vi.fn(async () => ({
      changeSet: {
        service: changeSet(),
        type: changeSet(),
        gqlPermission: changeSet(),
      },
      ...ownership(),
    })),
    applyTailorDB: vi.fn(),
    planWorkflow: vi.fn(async () => ({ changeSet: changeSet(), ...ownership() })),
    applyWorkflow: vi.fn(),
    assertHeld: vi.fn(),
    withDeployLock: vi.fn(
      async (_options: unknown, fn: (lock: { assertHeld(): void }) => Promise<unknown>) =>
        fn({ assertHeld: mocks.assertHeld }),
    ),
  };
});

vi.mock("#/cli/commands/deploy/deploy-lock", () => ({
  withDeployLock: mocks.withDeployLock,
}));
vi.mock("#/cli/commands/deploy/aigateway", () => ({
  planAIGateway: mocks.planAIGateway,
  applyAIGateway: mocks.applyAIGateway,
}));
vi.mock("#/cli/commands/deploy/application", () => ({
  planApplication: mocks.planApplication,
  applyApplication: mocks.applyApplication,
}));
vi.mock("#/cli/commands/deploy/auth", () => ({
  planAuth: mocks.planAuth,
  applyAuth: mocks.applyAuth,
}));
vi.mock("#/cli/commands/deploy/executor", () => ({
  planExecutor: mocks.planExecutor,
  applyExecutor: mocks.applyExecutor,
}));
vi.mock("#/cli/commands/deploy/function-registry", () => ({
  planFunctionRegistry: mocks.planFunctionRegistry,
  applyFunctionRegistry: mocks.applyFunctionRegistry,
}));
vi.mock("#/cli/commands/deploy/idp", () => ({
  planIdP: mocks.planIdP,
  applyIdP: mocks.applyIdP,
}));
vi.mock("#/cli/commands/deploy/resolver", () => ({
  planPipeline: mocks.planPipeline,
  applyPipeline: mocks.applyPipeline,
}));
vi.mock("#/cli/commands/deploy/secret-manager", () => ({
  planSecretManager: mocks.planSecretManager,
  applySecretManager: mocks.applySecretManager,
}));
vi.mock("#/cli/commands/deploy/staticwebsite", () => ({
  planStaticWebsite: mocks.planStaticWebsite,
  applyStaticWebsite: mocks.applyStaticWebsite,
}));
vi.mock("#/cli/commands/deploy/tailordb/index", () => ({
  planTailorDB: mocks.planTailorDB,
  applyTailorDB: mocks.applyTailorDB,
}));
vi.mock("#/cli/commands/deploy/workflow", () => ({
  planWorkflow: mocks.planWorkflow,
  applyWorkflow: mocks.applyWorkflow,
}));
vi.mock("#/cli/services/application", () => ({
  defineApplication: vi.fn(() => ({ name: "my-app", id: "app-id" })),
}));
vi.mock("#/cli/shared/client", async (importOriginal) => ({
  ...(await importOriginal()),
  initOperatorClient: vi.fn(),
}));
vi.mock("#/cli/shared/config-loader", () => ({
  loadConfig: vi.fn(async () => ({ config: { path: "/tailor.config.ts" } })),
}));
vi.mock("#/cli/shared/context", () => ({
  loadAccessToken: vi.fn(async () => "token"),
  loadWorkspaceId: vi.fn(async () => "workspace-id"),
}));
vi.mock("#/cli/shared/logger", () => ({
  logger: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    log: vi.fn(),
    newline: vi.fn(),
  },
  styles: {
    bold: (value: string) => value,
  },
  symbols: {
    create: "+",
    delete: "-",
    update: "~",
    replace: "±",
  },
}));
vi.mock("#/cli/shared/readonly-guard", () => ({ assertWritable: vi.fn() }));

describe("remove command", () => {
  aroundEach(async (runTest) => {
    vi.clearAllMocks();
    await runTest();
  });

  test("deletes a managed workflow execution policy when it is the only remaining resource", async () => {
    const client = {
      listWorkflowJobFunctionExecutionPolicies: vi.fn(async () => ({
        policies: [{ name: "premium" }],
        nextPageToken: "",
      })),
      getMetadata: vi.fn(async () => ({
        metadata: { labels: { "sdk-name": "my-app" } },
      })),
      deleteWorkflowJobFunctionExecutionPolicy: vi.fn(),
    };
    vi.mocked(initOperatorClient).mockResolvedValue(client as never);

    await runCommand(removeCommand, ["--yes"]);

    expect(vi.mocked(withDeployLock)).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-id",
        applications: [{ name: "my-app", id: "app-id" }],
      }),
      expect.any(Function),
    );
    expect(mocks.assertHeld.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.applyWorkflow.mock.invocationCallOrder[0]!,
    );
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining("Workflow execution policies:\n  - premium"),
    );
    expect(client.deleteWorkflowJobFunctionExecutionPolicy).toHaveBeenCalledWith({
      workspaceId: "workspace-id",
      executionPolicyName: "premium",
    });
    expect(mocks.applyWorkflow.mock.invocationCallOrder[0]!).toBeLessThan(
      client.deleteWorkflowJobFunctionExecutionPolicy.mock.invocationCallOrder[0]!,
    );
    expect(
      client.deleteWorkflowJobFunctionExecutionPolicy.mock.invocationCallOrder[0]!,
    ).toBeLessThan(mocks.applyExecutor.mock.invocationCallOrder[0]!);
    expect(logger.success).toHaveBeenNthCalledWith(
      1,
      "Removing all resources (--yes flag specified)...",
    );
    expect(logger.success).toHaveBeenNthCalledWith(
      2,
      'Successfully removed all resources managed by "my-app".',
    );
  });
  test("does not claim success when same-name resources were left behind", async () => {
    // A resource tagged with this application's name that it does not own by id
    // is skipped. Reporting success would say the workspace is clean when it is not.
    const client = {
      listWorkflowJobFunctionExecutionPolicies: vi.fn(async () => ({
        policies: [],
        nextPageToken: "",
      })),
      getMetadata: vi.fn(async () => ({ metadata: { labels: {} } })),
    };
    vi.mocked(initOperatorClient).mockResolvedValue(client as never);
    mocks.planExecutor.mockResolvedValueOnce({
      changeSet: mocks.changeSet(),
      conflicts: [],
      unmanaged: [],
      resourceOwners: new Set(["my-app"]),
    });

    await runCommand(removeCommand, ["--yes"]);

    expect(logger.success).not.toHaveBeenCalledWith(
      'Successfully removed all resources managed by "my-app".',
    );
    // The mismatch happens both when the config has no id and when it carries a
    // different one, so the message must not presuppose a missing id.
    const warned = vi
      .mocked(logger.warn)
      .mock.calls.map((call) => String(call[0]))
      .join("\n");
    expect(warned).toContain("my-app");
    expect(warned).toContain("does not match");
    expect(warned).toContain("deploy");
  });
});
