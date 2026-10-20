import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { MachineUserSchema } from "@tailor-platform/tailor-proto/auth_resource_pb";
import { runCommand } from "politty";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import { loadConfig } from "#/cli/shared/config-loader";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import { captureStdout } from "#/cli/shared/test-helpers/capture-output";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { listCommand, listMachineUsers } from "./list";

vi.mock("#/cli/shared/context", () => ({
  loadAccessToken: vi.fn(),
  loadWorkspaceId: vi.fn(),
}));

vi.mock("#/cli/shared/client", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  initOperatorClient: vi.fn(),
}));

vi.mock("#/cli/shared/config-loader", () => ({
  loadConfig: vi.fn(),
}));

const createdAt = new Date("2024-01-01T00:00:00.000Z");
const updatedAt = new Date("2024-02-01T00:00:00.000Z");

const machineUser = create(MachineUserSchema, {
  name: "ci-bot",
  clientId: "client-id",
  clientSecret: "client-secret",
  createdAt: timestampFromDate(createdAt),
  updatedAt: timestampFromDate(updatedAt),
});

describe("machineuser list", () => {
  aroundEach(async (runTest) => {
    vi.clearAllMocks();

    vi.mocked(loadAccessToken).mockResolvedValue("mock-token");
    vi.mocked(loadWorkspaceId).mockResolvedValue("workspace-1");
    vi.mocked(loadConfig).mockResolvedValue({
      config: { name: "my-app" },
    } as Awaited<ReturnType<typeof loadConfig>>);
    vi.mocked(initOperatorClient).mockResolvedValue({
      getApplication: vi.fn().mockResolvedValue({
        application: { authNamespace: "auth-ns" },
      }),
      listAuthMachineUsers: vi
        .fn()
        .mockResolvedValue({ machineUsers: [machineUser], nextPageToken: "" }),
    } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);

    await runTest();
  });

  test("returns the machine user without its client secret", async () => {
    const machineUsers = await listMachineUsers();

    expect(machineUsers).toEqual([
      {
        name: "ci-bot",
        clientId: "client-id",
        createdAt,
        updatedAt,
        attributes: {},
      },
    ]);
  });

  test("omits clientSecret from json output", async () => {
    using stdout = captureStdout();
    using _json = jsonMode();

    const result = await runCommand(listCommand, []);

    expect(result.success).toBe(true);
    expect(stdout.output).not.toContain("clientSecret");
    expect(stdout.output).not.toContain("client-secret");
  });
});
