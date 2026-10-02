import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { runCommand } from "@politty/zod";
import { MachineUserSchema } from "@tailor-platform/tailor-proto/auth_resource_pb";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { loadConfig } from "#/cli/shared/config-loader";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { captureStdout } from "#/cli/shared/test-helpers/capture-output";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { listCommand, listMachineUsers } from "./list";

vi.mock("#/cli/shared/operator-context", () => ({
  loadOperatorWorkspaceContext: vi.fn(),
}));

vi.mock("#/cli/shared/config-loader", () => ({
  loadConfig: vi.fn(),
}));

const createdAt = new Date("2024-01-01T00:00:00.000Z");
const updatedAt = new Date("2024-02-01T00:00:00.000Z");

const machineUser = create(MachineUserSchema, {
  id: "9f1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d",
  name: "ci-bot",
  clientId: "client-id",
  clientSecret: "client-secret",
  createdAt: timestampFromDate(createdAt),
  updatedAt: timestampFromDate(updatedAt),
});

describe("machineuser list", () => {
  let listAuthMachineUsersMock: ReturnType<typeof vi.fn>;

  aroundEach(async (runTest) => {
    vi.mocked(loadConfig).mockResolvedValue({
      config: { name: "my-app" },
    } as Awaited<ReturnType<typeof loadConfig>>);

    listAuthMachineUsersMock = vi
      .fn()
      .mockResolvedValue({ machineUsers: [machineUser], nextPageToken: "" });
    vi.mocked(loadOperatorWorkspaceContext).mockResolvedValue({
      workspaceId: "workspace-1",
      client: {
        getApplication: vi.fn().mockResolvedValue({
          application: { authNamespace: "auth-ns" },
        }),
        listAuthMachineUsers: listAuthMachineUsersMock,
      },
    } as unknown as Awaited<ReturnType<typeof loadOperatorWorkspaceContext>>);

    await runTest();
  });

  test("maps the machine user id returned by the platform", async () => {
    const machineUsers = await listMachineUsers();

    expect(machineUsers).toEqual([
      {
        id: "9f1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d",
        name: "ci-bot",
        clientId: "client-id",
        clientSecret: "client-secret",
        createdAt,
        updatedAt,
        attributes: {},
      },
    ]);
  });

  test("prints the id in json output", async () => {
    using stdout = captureStdout();
    using _json = jsonMode();

    const result = await runCommand(listCommand, []);

    expect(result.success).toBe(true);
    expect(JSON.parse(stdout.output)).toEqual([
      expect.objectContaining({ id: "9f1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d", name: "ci-bot" }),
    ]);
  });

  test("prints the id column in table output without the timestamp columns", async () => {
    let output = "";
    using _stdout = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output += String(chunk);
      return true;
    });

    const result = await runCommand(listCommand, []);

    expect(result.success).toBe(true);
    expect(output).toMatch(/│\s+id\s+│/);
    expect(output).toContain("9f1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d");
    expect(output).toContain("ci-bot");
    expect(output).not.toContain("createdAt");
    expect(output).not.toContain("updatedAt");
  });
});
