import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { truncate } from "./truncate";

// Mock dependencies
vi.mock("@/cli/shared/context", () => ({
  loadAccessToken: vi.fn().mockResolvedValue("mock-token"),
  loadWorkspaceId: vi.fn().mockResolvedValue("mock-workspace-id"),
}));

vi.mock("@/cli/shared/client", () => ({
  initOperatorClient: vi.fn().mockResolvedValue({
    truncateTailorDBType: vi.fn().mockResolvedValue(undefined),
    truncateTailorDBTypes: vi.fn().mockResolvedValue(undefined),
    listTailorDBTypes: vi.fn().mockResolvedValue({
      tailordbTypes: [{ name: "User" }, { name: "Order" }],
    }),
  }),
}));

vi.mock("@/cli/shared/config-loader", () => ({
  loadConfig: vi.fn().mockResolvedValue({
    config: {
      db: {
        tailordb: { files: ["./tailordb/*.ts"] },
        anotherdb: { files: ["./anotherdb/*.ts"] },
      },
    },
  }),
}));

vi.mock("@/cli/shared/logger", () => ({
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

vi.mock("@/cli/shared/prompt", () => ({
  prompt: {
    confirm: vi.fn().mockResolvedValue(true),
    text: vi.fn().mockResolvedValue(""),
  },
}));

describe("truncate command", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Re-setup default mock behavior after clearAllMocks
    const { prompt } = await import("@/cli/shared/prompt");
    vi.mocked(prompt.confirm).mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("argument validation", () => {
    test("throws error when no options are specified", async () => {
      await expect(truncate({})).rejects.toThrow(
        "Please specify one of: --all, --namespace <name>, or type names",
      );
    });

    test("throws error when --all is specified with --namespace", async () => {
      await expect(truncate({ all: true, namespace: "tailordb" })).rejects.toThrow(
        "Options --all, --namespace, and type names are mutually exclusive. Please specify only one.",
      );
    });

    test("throws error when --all is specified with type names", async () => {
      await expect(truncate({ all: true, types: ["User"] })).rejects.toThrow(
        "Options --all, --namespace, and type names are mutually exclusive. Please specify only one.",
      );
    });

    test("throws error when --namespace is specified with type names", async () => {
      await expect(truncate({ namespace: "tailordb", types: ["User"] })).rejects.toThrow(
        "Options --all, --namespace, and type names are mutually exclusive. Please specify only one.",
      );
    });

    test("throws error when all three options are specified", async () => {
      await expect(
        truncate({
          all: true,
          namespace: "tailordb",
          types: ["User"],
        }),
      ).rejects.toThrow(
        "Options --all, --namespace, and type names are mutually exclusive. Please specify only one.",
      );
    });
  });

  describe("truncate with --all flag", () => {
    test("truncates all namespaces", async () => {
      const { initOperatorClient } = await import("@/cli/shared/client");
      const client = await initOperatorClient("mock-token");

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
      const { loadConfig } = await import("@/cli/shared/config-loader");
      const { initOperatorClient } = await import("@/cli/shared/client");
      vi.mocked(loadConfig).mockResolvedValueOnce({
        config: {
          db: {
            owned: { files: ["./owned/*.ts"] },
            "shared-db": { external: true },
          },
        },
      } as unknown as Awaited<ReturnType<typeof loadConfig>>);
      const client = await initOperatorClient("mock-token");

      await truncate({ all: true });

      expect(client.truncateTailorDBTypes).toHaveBeenCalledTimes(1);
      expect(client.truncateTailorDBTypes).toHaveBeenCalledWith({
        workspaceId: "mock-workspace-id",
        namespaceName: "owned",
      });
    });

    test("warns and returns when only external namespaces exist", async () => {
      const { loadConfig } = await import("@/cli/shared/config-loader");
      const { initOperatorClient } = await import("@/cli/shared/client");
      const { logger } = await import("@/cli/shared/logger");
      vi.mocked(loadConfig).mockResolvedValueOnce({
        config: {
          db: {
            "shared-db": { external: true },
          },
        },
      } as unknown as Awaited<ReturnType<typeof loadConfig>>);
      const client = await initOperatorClient("mock-token");

      await truncate({ all: true });

      expect(client.truncateTailorDBTypes).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith("No namespaces found in config file.");
    });
  });

  describe("truncate with --namespace flag", () => {
    test("truncates all types in specified namespace", async () => {
      const { initOperatorClient } = await import("@/cli/shared/client");
      const client = await initOperatorClient("mock-token");

      await truncate({ namespace: "tailordb" });

      expect(client.truncateTailorDBTypes).toHaveBeenCalledTimes(1);
      expect(client.truncateTailorDBTypes).toHaveBeenCalledWith({
        workspaceId: "mock-workspace-id",
        namespaceName: "tailordb",
      });
    });

    test("throws error when namespace not found in config", async () => {
      await expect(truncate({ namespace: "nonexistent" })).rejects.toThrow(
        'Namespace "nonexistent" not found in config. Available namespaces: tailordb, anotherdb',
      );
    });

    test("rejects external namespaces with a dedicated error", async () => {
      const { loadConfig } = await import("@/cli/shared/config-loader");
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
    test("truncates single type", async () => {
      const { initOperatorClient } = await import("@/cli/shared/client");
      const client = await initOperatorClient("mock-token");

      await truncate({ types: ["User"] });

      expect(client.truncateTailorDBType).toHaveBeenCalledTimes(1);
      expect(client.truncateTailorDBType).toHaveBeenCalledWith({
        workspaceId: "mock-workspace-id",
        namespaceName: "tailordb",
        tailordbTypeName: "User",
      });
    });

    test("truncates multiple types", async () => {
      const { initOperatorClient } = await import("@/cli/shared/client");
      const client = await initOperatorClient("mock-token");

      await truncate({ types: ["User", "Order"] });

      expect(client.truncateTailorDBType).toHaveBeenCalledTimes(2);
      expect(client.truncateTailorDBType).toHaveBeenCalledWith({
        workspaceId: "mock-workspace-id",
        namespaceName: "tailordb",
        tailordbTypeName: "User",
      });
      expect(client.truncateTailorDBType).toHaveBeenCalledWith({
        workspaceId: "mock-workspace-id",
        namespaceName: "tailordb",
        tailordbTypeName: "Order",
      });
    });

    test("throws error when type not found in any namespace", async () => {
      const { initOperatorClient } = await import("@/cli/shared/client");

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
