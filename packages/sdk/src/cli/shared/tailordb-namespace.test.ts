import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, test, vi } from "vitest";
import { MAX_PAGE_SIZE } from "./client";
import { resolveTableNamespace, resolveTableNamespaces } from "./tailordb-namespace";

const namesResult = (...names: string[]) => ({
  tailordbTypes: names.map((name) => ({ name })),
  nextPageToken: "",
});

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

  test("resolves tables listed on every page", async () => {
    const client = {
      listTailorDBTypes: vi
        .fn()
        .mockResolvedValueOnce({ tailordbTypes: [{ name: "User" }], nextPageToken: "page-2" })
        .mockResolvedValueOnce(namesResult("Order")),
    };

    const result = await resolveTableNamespaces({
      workspaceId: "workspace-id",
      namespaces: ["main"],
      tableNames: ["User", "Order"],
      client,
    });

    expect(result.get("User")).toBe("main");
    expect(result.get("Order")).toBe("main");
    expect(client.listTailorDBTypes).toHaveBeenNthCalledWith(1, {
      workspaceId: "workspace-id",
      namespaceName: "main",
      pageToken: "",
      pageSize: MAX_PAGE_SIZE,
    });
    expect(client.listTailorDBTypes).toHaveBeenNthCalledWith(2, {
      workspaceId: "workspace-id",
      namespaceName: "main",
      pageToken: "page-2",
      pageSize: MAX_PAGE_SIZE,
    });
  });

  test("propagates a failure to list a namespace's tables, including NotFound", async () => {
    const listError = new ConnectError("workspace not found", Code.NotFound);
    const client = {
      listTailorDBTypes: vi
        .fn()
        .mockRejectedValueOnce(listError)
        .mockResolvedValueOnce(namesResult("User")),
    };

    await expect(
      resolveTableNamespaces({
        workspaceId: "workspace-id",
        namespaces: ["main", "analytics"],
        tableNames: ["User"],
        client,
      }),
    ).rejects.toBe(listError);
    expect(client.listTailorDBTypes).toHaveBeenCalledTimes(1);
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

  test("stops paging a namespace once every table is resolved", async () => {
    const client = {
      listTailorDBTypes: vi
        .fn()
        .mockResolvedValueOnce({ tailordbTypes: [{ name: "User" }], nextPageToken: "page-2" })
        .mockRejectedValueOnce(new ConnectError("transient failure", Code.Unavailable)),
    };

    const result = await resolveTableNamespaces({
      workspaceId: "workspace-id",
      namespaces: ["main"],
      tableNames: ["User"],
      client,
    });

    expect(result.get("User")).toBe("main");
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
