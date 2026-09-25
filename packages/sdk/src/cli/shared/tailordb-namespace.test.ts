import { describe, expect, test, vi } from "vitest";
import { resolveTableNamespace, resolveTableNamespaces } from "./tailordb-namespace";

const namesResult = (...names: string[]) => ({ tailordbTypes: names.map((name) => ({ name })) });

describe("resolveTableNamespaces", () => {
  test("resolves multiple tables from different namespaces", async () => {
    const client = {
      listTailorDBTypes: vi
        .fn()
        .mockResolvedValueOnce(namesResult("User"))
        .mockResolvedValueOnce(namesResult("Event")),
    };

    const result = await resolveTableNamespaces({
      workspaceId: "workspace-id",
      namespaces: ["main", "analytics"],
      tableNames: ["User", "Event"],
      client,
    });

    expect(result.get("User")).toBe("main");
    expect(result.get("Event")).toBe("analytics");
  });

  test("continues when one namespace call fails", async () => {
    const client = {
      listTailorDBTypes: vi
        .fn()
        .mockRejectedValueOnce(new Error("failed"))
        .mockResolvedValueOnce(namesResult("User")),
    };

    const result = await resolveTableNamespaces({
      workspaceId: "workspace-id",
      namespaces: ["main", "analytics"],
      tableNames: ["User"],
      client,
    });

    expect(result.get("User")).toBe("analytics");
  });

  test("stops querying when all tables are resolved", async () => {
    const client = { listTailorDBTypes: vi.fn().mockResolvedValueOnce(namesResult("User")) };

    await resolveTableNamespaces({
      workspaceId: "workspace-id",
      namespaces: ["main", "analytics"],
      tableNames: ["User"],
      client,
    });

    expect(client.listTailorDBTypes).toHaveBeenCalledTimes(1);
  });

  test("matches requested type names case-insensitively", async () => {
    const client = { listTailorDBTypes: vi.fn().mockResolvedValueOnce(namesResult("Project")) };

    const result = await resolveTableNamespaces({
      workspaceId: "workspace-id",
      namespaces: ["main"],
      tableNames: ["project"],
      client,
    });

    expect(result.get("project")).toBe("main");
  });
});

describe("resolveTableNamespace", () => {
  test("returns null when the type is not found", async () => {
    const client = { listTailorDBTypes: vi.fn().mockResolvedValue(namesResult("Order")) };

    const result = await resolveTableNamespace({
      workspaceId: "workspace-id",
      namespaces: ["main"],
      tableName: "User",
      client,
    });

    expect(result).toBeNull();
  });
});
