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

  test("propagates namespace lookup failures", async () => {
    const failure = new Error("failed");
    const client = {
      listTailorDBTypes: vi
        .fn()
        .mockRejectedValueOnce(failure)
        .mockResolvedValueOnce(namesResult("User")),
    };

    await expect(
      resolveTableNamespaces({
        workspaceId: "workspace-id",
        namespaces: ["main", "analytics"],
        tableNames: ["User"],
        client,
      }),
    ).rejects.toBe(failure);
  });

  test("checks remaining namespaces after finding the requested table", async () => {
    const client = {
      listTailorDBTypes: vi
        .fn()
        .mockResolvedValueOnce(namesResult("User"))
        .mockResolvedValueOnce(namesResult("Event")),
    };

    await resolveTableNamespaces({
      workspaceId: "workspace-id",
      namespaces: ["main", "analytics"],
      tableNames: ["User"],
      client,
    });

    expect(client.listTailorDBTypes).toHaveBeenCalledTimes(2);
  });

  test("rejects ambiguous table names case-insensitively", async () => {
    const client = {
      listTailorDBTypes: vi
        .fn()
        .mockResolvedValueOnce(namesResult("User"))
        .mockResolvedValueOnce(namesResult("user")),
    };

    await expect(
      resolveTableNamespaces({
        workspaceId: "workspace-id",
        namespaces: ["main", "shared"],
        tableNames: ["user"],
        client,
      }),
    ).rejects.toMatchObject({
      code: "TAILORDB_TABLE_NAMESPACE_AMBIGUOUS",
      context: { table: "user", namespaces: ["main", "shared"] },
    });
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
