import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { truncate, type TruncateOptions } from "./truncate";

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
    listTailorDBTypes: vi.fn().mockResolvedValue({
      tailordbTypes: [{ name: "User" }, { name: "Order" }],
    }),
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

vi.mock("#/cli/shared/logger", () => ({
  logger: {
    success: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
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
  beforeEach(async () => {
    vi.clearAllMocks();
    // Re-setup default mock behavior after clearAllMocks
    const { prompt } = await import("#/cli/shared/prompt");
    vi.mocked(prompt.confirm).mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("argument validation", () => {
    const mutuallyExclusiveError =
      "Options --all, --namespace, and type names are mutually exclusive. Please specify only one.";

    test.each<[string, TruncateOptions, string]>([
      [
        "no options are specified",
        {},
        "Please specify one of: --all, --namespace <name>, or type names",
      ],
      [
        "--all is specified with --namespace",
        { all: true, namespace: "tailordb" },
        mutuallyExclusiveError,
      ],
      [
        "--all is specified with type names",
        { all: true, types: ["User"] },
        mutuallyExclusiveError,
      ],
      [
        "--namespace is specified with type names",
        { namespace: "tailordb", types: ["User"] },
        mutuallyExclusiveError,
      ],
      [
        "all three options are specified",
        { all: true, namespace: "tailordb", types: ["User"] },
        mutuallyExclusiveError,
      ],
    ])("throws error when %s", async (_, options, message) => {
      await expect(truncate(options)).rejects.toThrow(message);
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
            "shared-db": { external: true },
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
            "shared-db": { external: true },
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
    test("truncates all types in specified namespace", async () => {
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
            "shared-db": { external: true },
          },
        },
      } as unknown as Awaited<ReturnType<typeof loadConfig>>);

      await expect(truncate({ namespace: "shared-db" })).rejects.toThrow(
        'Namespace "shared-db" is declared as external in this app\'s config and cannot be truncated from here. Run truncate from the app that owns it.',
      );
    });
  });

  describe("truncate with type names", () => {
    test.each<[string, string[]]>([
      ["truncates single type", ["User"]],
      ["truncates multiple types", ["User", "Order"]],
    ])("%s", async (_, types) => {
      const client = await getMockClient();

      await truncate({ types });

      expect(client.truncateTailorDBType).toHaveBeenCalledTimes(types.length);
      for (const tailordbTypeName of types) {
        expect(client.truncateTailorDBType).toHaveBeenCalledWith({
          workspaceId: "mock-workspace-id",
          namespaceName: "tailordb",
          tailordbTypeName,
        });
      }
    });

    test("throws error when type not found in any namespace", async () => {
      const { initOperatorClient } = await import("#/cli/shared/client");

      vi.mocked(initOperatorClient).mockResolvedValue({
        truncateTailorDBType: vi.fn(),
        truncateTailorDBTypes: vi.fn(),
        listTailorDBTypes: vi.fn().mockResolvedValue({
          tailordbTypes: [],
        }),
      } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);

      await expect(truncate({ types: ["NonExistentType"] })).rejects.toThrow(
        "The following types were not found in any namespace: NonExistentType",
      );
    });
  });
});
