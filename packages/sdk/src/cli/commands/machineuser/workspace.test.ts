import * as fs from "node:fs";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { runCommand } from "@politty/zod";
import { MachineUserSummarySchema } from "@tailor-platform/tailor-proto/auth_resource_pb";
import { PageDirection } from "@tailor-platform/tailor-proto/resource_pb";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fetchMachineUserToken } from "#/cli/shared/client";
import { logger } from "#/cli/shared/logger";
import { captureStdout } from "#/cli/shared/test-helpers/capture-output";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { mockOperatorClient } from "#/cli/shared/test-helpers/operator-client";
import { silenceLogger } from "#/cli/shared/test-helpers/silence-logger";
import { brandedDefault, writeWorkspaceProject } from "#/cli/shared/test-helpers/workspace-config";
import { listCommand, listMachineUsers, type MachineUserInfo } from "./list";
import { getMachineUserToken } from "./token";

const client = vi.hoisted(() => ({ current: undefined as unknown }));

vi.mock("#/cli/shared/operator-context", () => ({
  loadOperatorWorkspaceContext: vi.fn(async () => ({
    client: client.current,
    workspaceId: "workspace-id",
  })),
}));

vi.mock("#/cli/shared/client", async (importOriginal) => ({
  ...(await importOriginal()),
  fetchMachineUserToken: vi.fn(async () => ({
    access_token: "machine-token",
    token_type: "Bearer",
    expires_in: 3600,
  })),
}));

type DeployedMachineUsers = Record<string, Array<{ name: string; createdAt: string }>>;

const DEPLOYED: DeployedMachineUsers = {
  "corp-auth": [
    { name: "admin", createdAt: "2024-01-01T00:00:00.000Z" },
    { name: "seeder", createdAt: "2024-03-01T00:00:00.000Z" },
  ],
  "partner-auth": [{ name: "admin", createdAt: "2024-02-01T00:00:00.000Z" }],
};

const APPLICATIONS: Record<string, string> = {
  shop: "corp-auth",
  backoffice: "corp-auth",
  partner: "partner-auth",
  ops: "ops-auth",
};

function workspaceClient(deployed: DeployedMachineUsers = DEPLOYED) {
  return mockOperatorClient({
    listAuthMachineUsers: async ({ authNamespace, pageDirection, pageSize }) => {
      const users = deployed[authNamespace ?? ""];
      if (!users) throw new ConnectError("namespace does not exist", Code.NotFound);
      const ordered = pageDirection === PageDirection.DESC ? users.toReversed() : users;
      return {
        machineUsers: ordered.slice(0, pageSize).map(({ name, createdAt }) =>
          create(MachineUserSummarySchema, {
            id: `${authNamespace}-${name}`,
            name,
            clientId: `${authNamespace}-${name}`,
            createdAt: timestampFromDate(new Date(createdAt)),
          }),
        ),
        nextPageToken: "",
      };
    },
    getAuthMachineUser: async ({ authNamespace, name }) => {
      if (!deployed[authNamespace ?? ""]?.some((user) => user.name === name)) {
        throw new ConnectError("machine user not found", Code.NotFound);
      }
      return {
        machineUser: { name, clientId: `${authNamespace}-${name}`, clientSecret: "secret" },
      };
    },
    getApplication: async ({ applicationName }) => {
      const authNamespace = APPLICATIONS[applicationName ?? ""];
      if (!authNamespace) throw new ConnectError("application not found", Code.NotFound);
      return {
        application: {
          name: applicationName,
          authNamespace,
          url: `https://${applicationName}.example`,
        },
      };
    },
  });
}

const qualifiedNames = (users: MachineUserInfo[]) =>
  users.map(({ authNamespace, name }) => `${authNamespace}/${name}`);

describe("machineuser with a workspace config", () => {
  let dir: string;
  let configPath: string;

  beforeEach(() => {
    dir = fs.realpathSync(
      fs.mkdtempSync(path.join(import.meta.dirname, ".workspace-machineuser-")),
    );
    configPath = writeWorkspaceProject(dir);
    vi.stubEnv("TAILOR_PLATFORM_PROFILE", "");
    vi.stubEnv("TAILOR_PLATFORM_MACHINE_USER_NAME", "");
    silenceLogger("log", "info", "success", "debug");
    client.current = workspaceClient();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe("list", () => {
    test("lists the machine users of every Auth service, ordered together by creation", async () => {
      const users = await listMachineUsers({ configPath, order: "desc" });

      expect(qualifiedNames(users)).toEqual([
        "corp-auth/seeder",
        "partner-auth/admin",
        "corp-auth/admin",
      ]);
    });

    test("applies --limit to the combined list", async () => {
      using stdout = captureStdout();
      using _json = jsonMode();

      const result = await runCommand(listCommand, [
        "--config",
        configPath,
        "--order",
        "asc",
        "--limit",
        "2",
      ]);

      expect(result.success).toBe(true);
      expect(qualifiedNames(JSON.parse(stdout.output))).toEqual([
        "corp-auth/admin",
        "partner-auth/admin",
      ]);
    });

    test("shows the Auth service of each machine user in table output", async () => {
      let output = "";
      using _stdout = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
        output += String(chunk);
        return true;
      });

      const result = await runCommand(listCommand, ["--config", configPath]);

      expect(result.success).toBe(true);
      expect(output).toMatch(/│\s+authNamespace\s+│/);
      expect(output).toContain("partner-auth");
    });

    test("skips an Auth service that is not deployed yet, with a warning", async () => {
      client.current = workspaceClient({ "corp-auth": DEPLOYED["corp-auth"]! });
      using warn = vi.spyOn(logger, "warn").mockImplementation(() => {});

      const users = await listMachineUsers({ configPath, order: "asc" });

      expect(qualifiedNames(users)).toEqual(["corp-auth/admin", "corp-auth/seeder"]);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('"partner-auth"'));
    });
  });

  describe("token", () => {
    test("fetches the token from the first application on the Auth service that defines the machine user", async () => {
      await expect(getMachineUserToken({ configPath, name: "seeder" })).resolves.toMatchObject({
        accessToken: "machine-token",
      });

      expect(fetchMachineUserToken).toHaveBeenCalledWith(
        "https://shop.example",
        "corp-auth-seeder",
        "secret",
      );
    });

    test("takes a machine user qualified by its Auth service", async () => {
      await getMachineUserToken({ configPath, name: "partner-auth/admin" });

      expect(fetchMachineUserToken).toHaveBeenCalledWith(
        "https://partner.example",
        "partner-auth-admin",
        "secret",
      );
    });

    test("rejects a machine user name that several Auth services define", async () => {
      await expect(getMachineUserToken({ configPath, name: "admin" })).rejects.toMatchObject({
        code: "MACHINE_USER_AMBIGUOUS",
      });
      expect(fetchMachineUserToken).not.toHaveBeenCalled();
    });

    test("stops when no application uses the Auth service of the machine user", async () => {
      const opsConfigPath = path.join(dir, "ops.config.ts");
      fs.writeFileSync(
        opsConfigPath,
        `import { defineAuth } from "@tailor-platform/sdk";
${brandedDefault(
  "workspace-config",
  `{
  auth: {
    "corp-auth": defineAuth("corp-auth", { machineUsers: { admin: {} } }),
    "ops-auth": defineAuth("ops-auth", { machineUsers: { robot: {} } }),
  },
  apps: { shop: { auth: "corp-auth" } },
}`,
)}
`,
      );

      await expect(
        getMachineUserToken({ configPath: opsConfigPath, name: "robot" }),
      ).rejects.toMatchObject({ code: "MACHINE_USER_TOKEN_APP_NOT_FOUND" });
      expect(fetchMachineUserToken).not.toHaveBeenCalled();
    });
  });
});
