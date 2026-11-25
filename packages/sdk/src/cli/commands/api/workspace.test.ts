import * as fs from "node:fs";
import { runCommand } from "@politty/zod";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { brandedDefault } from "#/cli/shared/test-helpers/workspace-config";
import { apiCommand } from "./index";

const apiCallMock = vi.hoisted(() => vi.fn());
vi.mock("./api-call", () => ({ apiCall: apiCallMock }));

const WORKSPACE_CONFIG = `import { defineAuth, defineIdp } from "@tailor-platform/sdk";
${brandedDefault(
  "workspace-config",
  `{
  db: {
    "main-db": { files: ["./db/main/*.ts"] },
    "archive-db": { files: ["./db/archive/*.ts"] },
  },
  resolver: { "main-pipeline": { files: ["./resolvers/*.ts"] } },
  auth: { "main-auth": defineAuth("main-auth", { machineUsers: { admin: {} } }) },
  idp: { "main-idp": defineIdp("main-idp", { clients: ["web"] }) },
  apps: { shop: { db: ["main-db"], resolver: ["main-pipeline"], auth: "main-auth", idp: ["main-idp"] } },
}`,
)}
`;

describe("api with a workspace config", () => {
  let dir: string;
  let configPath: string;

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(import.meta.dirname, ".workspace-api-")));
    configPath = path.join(dir, "tailor.config.ts");
    fs.writeFileSync(configPath, WORKSPACE_CONFIG);
    vi.stubEnv("TAILOR_PLATFORM_PROFILE", "");
    vi.stubEnv("TAILOR_PLATFORM_WORKSPACE_ID", "d9d0d1e0-1f2a-4b3c-8d4e-5f6a7b8c9d0e");
    apiCallMock.mockResolvedValue({ status: 200, data: {} });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    apiCallMock.mockReset();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test.each([
    ["GetAuthService", "main-auth"],
    ["GetIdPService", "main-idp"],
    ["GetPipelineService", "main-pipeline"],
    ["ListTailorDBTypes", undefined],
  ])("sets namespaceName of %s to %s, the only service of its kind", async (endpoint, ns) => {
    using _stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const result = await runCommand(apiCommand, [endpoint, "--config", configPath]);

    expect(result.success).toBe(true);
    const [{ body }] = apiCallMock.mock.calls[0] as [{ body: string }];
    expect(JSON.parse(body).namespaceName).toBe(ns);
  });
});
