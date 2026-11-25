import * as fs from "node:fs";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { runCommand } from "@politty/zod";
import {
  AuthOAuth2ClientSchema,
  AuthOAuth2ClientSummarySchema,
} from "@tailor-platform/tailor-proto/auth_resource_pb";
import { PageDirection } from "@tailor-platform/tailor-proto/resource_pb";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { logger } from "#/cli/shared/logger";
import { captureStdout } from "#/cli/shared/test-helpers/capture-output";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { mockOperatorClient } from "#/cli/shared/test-helpers/operator-client";
import { silenceLogger } from "#/cli/shared/test-helpers/silence-logger";
import { brandedDefault } from "#/cli/shared/test-helpers/workspace-config";
import { getOAuth2Client } from "./get";
import { listCommand, listOAuth2Clients } from "./list";
import type { OAuth2ClientInfo } from "./transform";

const client = vi.hoisted(() => ({ current: undefined as unknown }));

vi.mock("#/cli/shared/operator-context", () => ({
  loadOperatorWorkspaceContext: vi.fn(async () => ({
    client: client.current,
    workspaceId: "workspace-id",
  })),
}));

const WORKSPACE_CONFIG = `import { defineAuth } from "@tailor-platform/sdk";
${brandedDefault(
  "workspace-config",
  `{
  auth: {
    "corp-auth": defineAuth("corp-auth", {
      oauth2Clients: {
        web: { redirectURIs: ["https://corp.example/callback"] },
        cli: { redirectURIs: ["http://localhost:8080/callback"] },
      },
    }),
    "partner-auth": defineAuth("partner-auth", {
      oauth2Clients: { web: { redirectURIs: ["https://partner.example/callback"] } },
    }),
  },
  apps: {
    shop: { auth: "corp-auth" },
    partner: { auth: "partner-auth" },
  },
}`,
)}
`;

type DeployedOAuth2Clients = Record<string, Array<{ name: string; createdAt: string }>>;

const DEPLOYED: DeployedOAuth2Clients = {
  "corp-auth": [
    { name: "web", createdAt: "2024-01-01T00:00:00.000Z" },
    { name: "cli", createdAt: "2024-03-01T00:00:00.000Z" },
  ],
  "partner-auth": [{ name: "web", createdAt: "2024-02-01T00:00:00.000Z" }],
};

function workspaceClient(deployed: DeployedOAuth2Clients = DEPLOYED) {
  return mockOperatorClient({
    listAuthOAuth2Clients: async ({ namespaceName, pageDirection, pageSize }) => {
      const clients = deployed[namespaceName ?? ""];
      if (!clients) throw new ConnectError("namespace does not exist", Code.NotFound);
      const ordered = pageDirection === PageDirection.DESC ? clients.toReversed() : clients;
      return {
        oauth2Clients: ordered.slice(0, pageSize).map(({ name, createdAt }) =>
          create(AuthOAuth2ClientSummarySchema, {
            name,
            clientId: `${namespaceName}-${name}`,
            createdAt: timestampFromDate(new Date(createdAt)),
          }),
        ),
        nextPageToken: "",
      };
    },
    getAuthOAuth2Client: async ({ namespaceName, name }) => {
      if (!deployed[namespaceName ?? ""]?.some((oauth2Client) => oauth2Client.name === name)) {
        throw new ConnectError("oauth2 client not found", Code.NotFound);
      }
      return {
        oauth2Client: create(AuthOAuth2ClientSchema, {
          name,
          clientId: `${namespaceName}-${name}`,
          clientSecret: "secret",
        }),
      };
    },
  });
}

const qualifiedNames = (oauth2Clients: OAuth2ClientInfo[]) =>
  oauth2Clients.map(({ authNamespace, name }) => `${authNamespace}/${name}`);

describe("oauth2client with a workspace config", () => {
  let dir: string;
  let configPath: string;

  beforeEach(() => {
    dir = fs.realpathSync(
      fs.mkdtempSync(path.join(import.meta.dirname, ".workspace-oauth2client-")),
    );
    configPath = path.join(dir, "tailor.config.ts");
    fs.writeFileSync(configPath, WORKSPACE_CONFIG);
    silenceLogger("log", "info", "success", "debug");
    client.current = workspaceClient();
  });

  afterEach(() => {
    vi.clearAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe("list", () => {
    test("lists the OAuth2 clients of every Auth service, ordered together by creation", async () => {
      const oauth2Clients = await listOAuth2Clients({ configPath, order: "desc" });

      expect(qualifiedNames(oauth2Clients)).toEqual([
        "corp-auth/cli",
        "partner-auth/web",
        "corp-auth/web",
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
        "corp-auth/web",
        "partner-auth/web",
      ]);
    });

    test("shows the Auth service of each OAuth2 client in table output", async () => {
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

      const oauth2Clients = await listOAuth2Clients({ configPath, order: "asc" });

      expect(qualifiedNames(oauth2Clients)).toEqual(["corp-auth/web", "corp-auth/cli"]);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('"partner-auth"'));
    });
  });

  describe("get", () => {
    test("gets an OAuth2 client from the only Auth service that defines it", async () => {
      await expect(getOAuth2Client({ configPath, name: "cli" })).resolves.toMatchObject({
        clientId: "corp-auth-cli",
      });
    });

    test("takes an OAuth2 client qualified by its Auth service", async () => {
      await expect(
        getOAuth2Client({ configPath, name: "partner-auth/web" }),
      ).resolves.toMatchObject({ clientId: "partner-auth-web" });
    });

    test.each([
      ["web", "OAUTH2_CLIENT_AMBIGUOUS"],
      ["mobile", "OAUTH2_CLIENT_NOT_FOUND"],
      ["partner-auth/cli", "OAUTH2_CLIENT_NOT_FOUND"],
      ["ops-auth/web", "AUTH_NOT_FOUND"],
      ["corp-auth/web/extra", "OAUTH2_CLIENT_INVALID"],
    ])("rejects %s with %s before asking the Platform", async (name, code) => {
      const mock = workspaceClient();
      client.current = mock;

      await expect(getOAuth2Client({ configPath, name })).rejects.toMatchObject({ code });
      expect(mock.getAuthOAuth2Client).not.toHaveBeenCalled();
    });
  });
});
