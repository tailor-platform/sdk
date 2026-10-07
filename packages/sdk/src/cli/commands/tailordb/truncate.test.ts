import { runCommand } from "@politty/zod";
import { describe, test, expect, vi, aroundEach } from "vitest";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { truncate, truncateCommand, type TruncateOptions } from "./truncate";

// Mock dependencies
vi.mock("#/cli/shared/context", () => ({
  loadAccessToken: vi.fn().mockResolvedValue("mock-token"),
  loadWorkspaceId: vi.fn().mockResolvedValue("mock-workspace-id"),
}));

vi.mock("#/cli/shared/readonly-guard", () => ({
  assertWritable: vi.fn(),
}));

vi.mock("#/cli/shared/client", () => ({
  initOperatorClient: vi.fn().mockResolvedValue({
    truncateTailorDBType: vi.fn().mockResolvedValue(undefined),
    truncateTailorDBTypes: vi.fn().mockResolvedValue(undefined),
    listTailorDBTypes: vi.fn().mockImplementation(async ({ namespaceName }) => ({
      tailordbTypes: namespaceName === "tailordb" ? [{ name: "User" }, { name: "Order" }] : [],
    })),
  }),
}));

vi.mock("#/cli/shared/config-loader", () => ({
  loadConfig: vi.fn().mockResolvedValue({
    config: {
      db: {
        tailordb: { files: ["./tailordb/*.ts"] },
        anotherdb: { files: ["./anotherdb/*.ts"] },
      },
    },
  }),
}));

vi.mock("#/cli/shared/logger", async (importOriginal) => ({
  ...(await importOriginal()),
  logger: {
    success: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    out: vi.fn(),
    jsonMode: false,
  },
  styles: {
    dim: vi.fn((s: string) => s),
  },
  symbols: {},
}));

vi.mock("#/cli/shared/prompt", () => ({
  prompt: {
    confirm: vi.fn().mockResolvedValue(true),
    text: vi.fn().mockResolvedValue(""),
  },
}));

async function getMockClient() {
  const { initOperatorClient } = await import("#/cli/shared/client");
  return initOperatorClient("mock-token");
}

describe("truncate command", () => {
  aroundEach(async (runTest) => {
    // Re-setup default mock behavior after clearAllMocks
    const { prompt } = await import("#/cli/shared/prompt");
    vi.mocked(prompt.confirm).mockResolvedValue(true);
    await runTest();
    vi.restoreAllMocks();
  });

  describe("argument validation", () => {
    const mutuallyExclusiveError =
      "Options --all, --namespace, and table names are mutually exclusive. Please specify only one.";

    test.each<[string, TruncateOptions, string]>([
      [
        "no options are specified",
        {},
        "Please specify one of: --all, --namespace <name>, or table names",
      ],
      [
        "--all is specified with --namespace",
        { all: true, namespace: "tailordb" },
        mutuallyExclusiveError,
      ],
      [
        "--all is specified with table names",
        { all: true, tables: ["User"] },
        mutuallyExclusiveError,
      ],
      [
        "--namespace is specified with table names",
        { namespace: "tailordb", tables: ["User"] },
        mutuallyExclusiveError,
      ],
      [
        "all three options are specified",
        { all: true, namespace: "tailordb", tables: ["User"] },
        mutuallyExclusiveError,
      ],
    ])("throws error when %s", async (_, options, message) => {
      await expect(truncate(options)).rejects.toThrow(message);
    });
  });

  describe("confirmation through the command", () => {
    test.each<[string, string[], "truncateTailorDBTypes" | "truncateTailorDBType"]>([
      ["--all", ["--all"], "truncateTailorDBTypes"],
      ["--namespace", ["--namespace", "tailordb"], "truncateTailorDBTypes"],
      ["table names", ["User"], "truncateTailorDBType"],
    ])("truncates after the prompt is accepted for %s", async (_, argv, rpc) => {
      const { prompt } = await import("#/cli/shared/prompt");
      vi.mocked(prompt.confirm).mockResolvedValue(true);
      const client = await getMockClient();
      vi.mocked(client[rpc]).mockClear();

      const result = await runCommand(truncateCommand, argv);

      expect(result.success).toBe(true);
      expect(prompt.confirm).toHaveBeenCalledWith(expect.objectContaining({ default: false }));
      expect(client[rpc]).toHaveBeenCalledWith(
        expect.objectContaining({ namespaceName: "tailordb" }),
      );
    });
  });

  describe("declined confirmation", () => {
    test.each<[string, string[]]>([
      ["--all", ["--all"]],
      ["--namespace", ["--namespace", "tailordb"]],
      ["table names", ["User"]],
    ])("fails without truncating for %s", async (_, argv) => {
      const { prompt } = await import("#/cli/shared/prompt");
      vi.mocked(prompt.confirm).mockResolvedValue(false);
      const client = await getMockClient();
      vi.mocked(client.truncateTailorDBTypes).mockClear();
      vi.mocked(client.truncateTailorDBType).mockClear();

      const result = await runCommand(truncateCommand, argv);

      expect(prompt.confirm).toHaveBeenCalledWith(expect.objectContaining({ default: false }));
      expect(result.error).toMatchObject({ code: "TRUNCATE_CANCELLED" });

      expect(client.truncateTailorDBTypes).not.toHaveBeenCalled();
      expect(client.truncateTailorDBType).not.toHaveBeenCalled();
    });
  });

  describe("truncate with --all flag", () => {
    test("truncates all namespaces", async () => {
      const client = await getMockClient();

      await truncate({ all: true });

      expect(client.truncateTailorDBTypes).toHaveBeenCalledTimes(2);
      expect(client.truncateTailorDBTypes).toHaveBeenCalledWith({
        workspaceId: "mock-workspace-id",
        namespaceName: "tailordb",
      });
      expect(client.truncateTailorDBTypes).toHaveBeenCalledWith({
        workspaceId: "mock-workspace-id",
        namespaceName: "anotherdb",
      });
    });

    test("excludes external namespaces", async () => {
      const { loadConfig } = await import("#/cli/shared/config-loader");
      vi.mocked(loadConfig).mockResolvedValueOnce({
        config: {
          db: {
            owned: { files: ["./owned/*.ts"] },
            "shared-db": { attach: true },
            visible: { attach: true },
            shared: { attach: true, schemaFrom: "owner.ts" },
            sql: { attach: false, schemaFrom: "owner.ts" },
          },
        },
      } as unknown as Awaited<ReturnType<typeof loadConfig>>);
      const client = await getMockClient();

      await truncate({ all: true });

      expect(client.truncateTailorDBTypes).toHaveBeenCalledTimes(1);
      expect(client.truncateTailorDBTypes).toHaveBeenCalledWith({
        workspaceId: "mock-workspace-id",
        namespaceName: "owned",
      });
    });

    test("warns and returns when only external namespaces exist", async () => {
      const { loadConfig } = await import("#/cli/shared/config-loader");
      const { logger } = await import("#/cli/shared/logger");
      vi.mocked(loadConfig).mockResolvedValueOnce({
        config: {
          db: {
            "shared-db": { attach: true },
            visible: { attach: true },
            shared: { attach: true, schemaFrom: "owner.ts" },
            sql: { attach: false, schemaFrom: "owner.ts" },
          },
        },
      } as unknown as Awaited<ReturnType<typeof loadConfig>>);
      const client = await getMockClient();

      await truncate({ all: true });

      expect(client.truncateTailorDBTypes).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith("No namespaces found in config file.");
    });
  });

  describe("truncate with --namespace flag", () => {
    test("truncates all tables in specified namespace", async () => {
      const client = await getMockClient();

      await truncate({ namespace: "tailordb" });

      expect(client.truncateTailorDBTypes).toHaveBeenCalledTimes(1);
      expect(client.truncateTailorDBTypes).toHaveBeenCalledWith({
        workspaceId: "mock-workspace-id",
        namespaceName: "tailordb",
      });
    });

    test("throws error when namespace not found in config", async () => {
      await expect(truncate({ namespace: "nonexistent" })).rejects.toThrow(
        'Namespace "nonexistent" not found in config. Available owned namespaces (external namespaces are excluded): tailordb, anotherdb',
      );
    });

    test("rejects external namespaces with a dedicated error", async () => {
      const { loadConfig } = await import("#/cli/shared/config-loader");
      vi.mocked(loadConfig).mockResolvedValueOnce({
        config: {
          db: {
            owned: { files: ["./owned/*.ts"] },
            "shared-db": { attach: true },
            visible: { attach: true },
            shared: { attach: true, schemaFrom: "owner.ts" },
            sql: { attach: false, schemaFrom: "owner.ts" },
          },
        },
      } as unknown as Awaited<ReturnType<typeof loadConfig>>);

      await expect(truncate({ namespace: "shared-db" })).rejects.toMatchObject({
        code: "TAILORDB_NAMESPACE_EXTERNAL",
        message:
          'Namespace "shared-db" is declared as external in this app\'s config and cannot be truncated from here.',
        suggestion: "Run truncate from the app that owns the namespace.",
      });
    });
  });

  describe("truncate with table names", () => {
    test.each<[string, string[]]>([
      ["truncates a single table", ["User"]],
      ["truncates multiple tables", ["User", "Order"]],
    ])("%s", async (_, names) => {
      const client = await getMockClient();

      await truncate({ tables: names });

      expect(client.truncateTailorDBType).toHaveBeenCalledTimes(names.length);
      for (const tailordbTypeName of names) {
        expect(client.truncateTailorDBType).toHaveBeenCalledWith({
          workspaceId: "mock-workspace-id",
          namespaceName: "tailordb",
          tailordbTypeName,
        });
      }
    });

    test("throws error when table not found in any namespace", async () => {
      const { initOperatorClient } = await import("#/cli/shared/client");

      vi.mocked(initOperatorClient).mockResolvedValue({
        truncateTailorDBType: vi.fn(),
        truncateTailorDBTypes: vi.fn(),
        listTailorDBTypes: vi.fn().mockResolvedValue({
          tailordbTypes: [],
        }),
      } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);

      await expect(truncate({ tables: ["NonExistentType"] })).rejects.toThrow(
        "The following tables were not found in any namespace: NonExistentType",
      );
    });
  });

  describe("JSON output", () => {
    test.each<[string, string[], object]>([
      ["every owned namespace", ["--all"], { namespaces: ["tailordb", "anotherdb"], tables: [] }],
      ["one namespace", ["--namespace", "tailordb"], { namespaces: ["tailordb"], tables: [] }],
      [
        "named tables",
        ["User", "Order"],
        {
          namespaces: [],
          tables: [
            { namespace: "tailordb", name: "User" },
            { namespace: "tailordb", name: "Order" },
          ],
        },
      ],
    ])("prints what was truncated for %s", async (_, argv, truncated) => {
      const { initOperatorClient } = await import("#/cli/shared/client");
      const { logger } = await import("#/cli/shared/logger");
      vi.mocked(initOperatorClient).mockResolvedValue({
        truncateTailorDBType: vi.fn(),
        truncateTailorDBTypes: vi.fn(),
        listTailorDBTypes: vi.fn().mockResolvedValue({
          tailordbTypes: [{ name: "User" }, { name: "Order" }],
        }),
      } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);
      using _json = jsonMode();

      const result = await runCommand(truncateCommand, [...argv, "--yes"]);

      expect(result.success).toBe(true);
      expect(logger.out).toHaveBeenCalledWith({
        changed: true,
        workspaceId: "mock-workspace-id",
        ...truncated,
      });
    });

    test("reports no change when no owned namespace exists", async () => {
      const { loadConfig } = await import("#/cli/shared/config-loader");
      const { logger } = await import("#/cli/shared/logger");
      vi.mocked(loadConfig).mockResolvedValueOnce({
        config: { db: { "shared-db": { external: true } } },
      } as unknown as Awaited<ReturnType<typeof loadConfig>>);
      using _json = jsonMode();

      const result = await runCommand(truncateCommand, ["--all", "--yes"]);

      expect(result.success).toBe(true);
      expect(logger.out).toHaveBeenCalledWith({
        changed: false,
        workspaceId: "mock-workspace-id",
        namespaces: [],
        tables: [],
      });
    });
  });
});
