import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { truncate } from "./truncate";

// Mock dependencies
vi.mock("../context", () => ({
  loadAccessToken: vi.fn().mockResolvedValue("mock-token"),
  loadWorkspaceId: vi.fn().mockReturnValue("mock-workspace-id"),
}));

vi.mock("../client", () => ({
  initOperatorClient: vi.fn().mockResolvedValue({
    truncateTailorDBType: vi.fn().mockResolvedValue(undefined),
    truncateTailorDBTypes: vi.fn().mockResolvedValue(undefined),
    listTailorDBTypes: vi.fn().mockResolvedValue({
      tailordbTypes: [{ name: "User" }, { name: "Order" }],
    }),
  }),
}));

vi.mock("../config-loader", () => ({
  loadConfig: vi.fn().mockResolvedValue({
    config: {
      db: {
        tailordb: { files: ["./tailordb/*.ts"] },
        anotherdb: { files: ["./anotherdb/*.ts"] },
      },
    },
  }),
}));

vi.mock("../utils/logger", () => ({
  logger: {
    success: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    prompt: vi.fn().mockResolvedValue(true),
  },
  styles: {
    dim: vi.fn((s: string) => s),
  },
  symbols: {},
}));

describe("truncate command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      await expect(truncate({ all: true, namespace: "tailordb", yes: true })).rejects.toThrow(
        "Options --all, --namespace, and type names are mutually exclusive. Please specify only one.",
      );
    });

    test("throws error when --all is specified with type names", async () => {
      await expect(truncate({ all: true, types: ["User"], yes: true })).rejects.toThrow(
        "Options --all, --namespace, and type names are mutually exclusive. Please specify only one.",
      );
    });

    test("throws error when --namespace is specified with type names", async () => {
      await expect(truncate({ namespace: "tailordb", types: ["User"], yes: true })).rejects.toThrow(
        "Options --all, --namespace, and type names are mutually exclusive. Please specify only one.",
      );
    });

    test("throws error when all three options are specified", async () => {
      await expect(
        truncate({
          all: true,
          namespace: "tailordb",
          types: ["User"],
          yes: true,
        }),
      ).rejects.toThrow(
        "Options --all, --namespace, and type names are mutually exclusive. Please specify only one.",
      );
    });
  });

  describe("truncate with --all flag", () => {
    test("truncates all namespaces", async () => {
      const { initOperatorClient } = await import("../client");
      const client = await initOperatorClient("mock-token");

      await truncate({ all: true, yes: true });

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
  });

  describe("truncate with --namespace flag", () => {
    test("truncates all types in specified namespace", async () => {
      const { initOperatorClient } = await import("../client");
      const client = await initOperatorClient("mock-token");

      await truncate({ namespace: "tailordb", yes: true });

      expect(client.truncateTailorDBTypes).toHaveBeenCalledTimes(1);
      expect(client.truncateTailorDBTypes).toHaveBeenCalledWith({
        workspaceId: "mock-workspace-id",
        namespaceName: "tailordb",
      });
    });

    test("throws error when namespace not found in config", async () => {
      await expect(truncate({ namespace: "nonexistent", yes: true })).rejects.toThrow(
        'Namespace "nonexistent" not found in config. Available namespaces: tailordb, anotherdb',
      );
    });
  });

  describe("truncate with type names", () => {
    test("truncates single type", async () => {
      const { initOperatorClient } = await import("../client");
      const client = await initOperatorClient("mock-token");

      await truncate({ types: ["User"], yes: true });

      expect(client.truncateTailorDBType).toHaveBeenCalledTimes(1);
      expect(client.truncateTailorDBType).toHaveBeenCalledWith({
        workspaceId: "mock-workspace-id",
        namespaceName: "tailordb",
        tailordbTypeName: "User",
      });
    });

    test("truncates multiple types", async () => {
      const { initOperatorClient } = await import("../client");
      const client = await initOperatorClient("mock-token");

      await truncate({ types: ["User", "Order"], yes: true });

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
      const { initOperatorClient } = await import("../client");

      vi.mocked(initOperatorClient).mockResolvedValue({
        truncateTailorDBType: vi.fn(),
        truncateTailorDBTypes: vi.fn(),
        listTailorDBTypes: vi.fn().mockResolvedValue({
          tailordbTypes: [],
        }),
      } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);

      await expect(truncate({ types: ["NonExistentType"], yes: true })).rejects.toThrow(
        "The following types were not found in any namespace: NonExistentType",
      );
    });
  });

  describe("confirmation prompt", () => {
    test("prompts for confirmation when --yes is not specified", async () => {
      const { logger } = await import("../utils/logger");

      await truncate({ namespace: "tailordb" });

      expect(logger.prompt).toHaveBeenCalled();
    });

    test("skips confirmation when --yes is specified", async () => {
      const { logger } = await import("../utils/logger");

      await truncate({ namespace: "tailordb", yes: true });

      expect(logger.prompt).not.toHaveBeenCalled();
    });

    test("cancels operation when user declines confirmation", async () => {
      const { logger } = await import("../utils/logger");
      const { initOperatorClient } = await import("../client");
      const client = await initOperatorClient("mock-token");

      vi.mocked(logger.prompt).mockResolvedValueOnce(false);

      await truncate({ namespace: "tailordb" });

      expect(logger.info).toHaveBeenCalledWith("Truncate cancelled.");
      expect(client.truncateTailorDBTypes).not.toHaveBeenCalled();
    });
  });
});
