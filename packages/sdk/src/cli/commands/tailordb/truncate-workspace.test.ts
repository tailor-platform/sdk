import * as fs from "node:fs";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mockOperatorClient } from "#/cli/shared/test-helpers/operator-client";
import { silenceLogger } from "#/cli/shared/test-helpers/silence-logger";
import { writeWorkspaceProject } from "#/cli/shared/test-helpers/workspace-config";
import { truncate } from "./truncate";

const client = vi.hoisted(() => ({ current: undefined as unknown }));

vi.mock("#/cli/shared/context", async (importOriginal) => ({
  ...(await importOriginal()),
  loadAccessToken: vi.fn(async () => "token"),
  loadWorkspaceId: vi.fn(async () => "workspace-id"),
}));

vi.mock("#/cli/shared/client", async (importOriginal) => ({
  ...(await importOriginal()),
  initOperatorClient: vi.fn(async () => client.current),
}));

function workspaceClient(tables: Record<string, string[]>) {
  return mockOperatorClient({
    truncateTailorDBType: {},
    truncateTailorDBTypes: {},
    listTailorDBTypes: async ({ namespaceName }) => ({
      tailordbTypes: (tables[namespaceName ?? ""] ?? []).map((name) => ({ name })),
      nextPageToken: "",
    }),
  });
}

describe("truncate with a workspace config", () => {
  let dir: string;
  let configPath: string;

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(import.meta.dirname, ".workspace-truncate-")));
    configPath = writeWorkspaceProject(dir);
    vi.stubEnv("TAILOR_BUILD_OUTPUT_DIR", path.join(dir, ".tailor"));
    silenceLogger("log", "info", "success", "warn", "debug");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("--all truncates every namespace, including one no application lists", async () => {
    const mock = workspaceClient({});
    client.current = mock;

    await truncate({ configPath, all: true });

    expect(mock.truncateTailorDBTypes.mock.calls.map(([request]) => request.namespaceName)).toEqual(
      ["customer-db", "order-db", "ledger-db"],
    );
  });

  test("names the namespace --namespace gives when a table is not in it", async () => {
    client.current = workspaceClient({ "order-db": ["Order"] });

    await expect(
      truncate({ configPath, tables: ["Order"], namespace: "ledger-db" }),
    ).rejects.toMatchObject({
      code: "TAILORDB_TABLE_NOT_FOUND",
      message: 'The following tables were not found in namespace "ledger-db": Order',
    });
  });

  test("rejects a table several namespaces have, and truncates it in the one --namespace names", async () => {
    const mock = workspaceClient({ "order-db": ["Order"], "ledger-db": ["Entry", "Order"] });
    client.current = mock;

    await expect(truncate({ configPath, tables: ["Order"] })).rejects.toMatchObject({
      code: "TAILORDB_TABLE_NAMESPACE_AMBIGUOUS",
    });
    expect(mock.truncateTailorDBType).not.toHaveBeenCalled();

    await truncate({ configPath, tables: ["Order"], namespace: "ledger-db" });
    expect(mock.truncateTailorDBType).toHaveBeenCalledWith({
      workspaceId: "workspace-id",
      namespaceName: "ledger-db",
      tailordbTypeName: "Order",
    });
  });
});
