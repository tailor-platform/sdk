import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, test } from "vitest";
import { MAX_PAGE_SIZE } from "./client";
import { resolveTableNamespaces, resolveUniqueTableNamespaces } from "./tailordb-namespace";
import { mockOperatorClient } from "./test-helpers/operator-client";

const namesResult = (...names: string[]) => ({
  tailordbTypes: names.map((name) => ({ name })),
  nextPageToken: "",
});

function listingClient() {
  return mockOperatorClient({ listTailorDBTypes: namesResult() });
}

describe("resolveTableNamespaces", () => {
  test("resolves multiple tables from different namespaces", async () => {
    const client = listingClient();
    client.listTailorDBTypes
      .mockResolvedValueOnce(namesResult("User"))
      .mockResolvedValueOnce(namesResult("Event"));

    const result = await resolveTableNamespaces({
      workspaceId: "workspace-id",
      namespaces: ["main", "analytics"],
      tableNames: ["User", "Event"],
      client,
    });

    expect(result.get("User")).toEqual(["main"]);
    expect(result.get("Event")).toEqual(["analytics"]);
  });

  test("finds a table in every namespace that has it", async () => {
    const client = listingClient();
    client.listTailorDBTypes
      .mockResolvedValueOnce(namesResult("User"))
      .mockResolvedValueOnce(namesResult("user", "Event"));

    const result = await resolveTableNamespaces({
      workspaceId: "workspace-id",
      namespaces: ["main", "analytics"],
      tableNames: ["User"],
      client,
    });

    expect(result.get("User")).toEqual(["main", "analytics"]);
  });

  test("resolves tables listed on every page", async () => {
    const client = listingClient();
    client.listTailorDBTypes
      .mockResolvedValueOnce({ tailordbTypes: [{ name: "User" }], nextPageToken: "page-2" })
      .mockResolvedValueOnce(namesResult("Order"));

    const result = await resolveTableNamespaces({
      workspaceId: "workspace-id",
      namespaces: ["main"],
      tableNames: ["User", "Order"],
      client,
    });

    expect(result.get("User")).toEqual(["main"]);
    expect(result.get("Order")).toEqual(["main"]);
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
    const client = listingClient();
    client.listTailorDBTypes
      .mockRejectedValueOnce(listError)
      .mockResolvedValueOnce(namesResult("User"));

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

  test("stops paging a namespace once every table is resolved", async () => {
    const client = listingClient();
    client.listTailorDBTypes
      .mockResolvedValueOnce({ tailordbTypes: [{ name: "User" }], nextPageToken: "page-2" })
      .mockRejectedValueOnce(new ConnectError("transient failure", Code.Unavailable));

    const result = await resolveTableNamespaces({
      workspaceId: "workspace-id",
      namespaces: ["main"],
      tableNames: ["User"],
      client,
    });

    expect(result.get("User")).toEqual(["main"]);
    expect(client.listTailorDBTypes).toHaveBeenCalledTimes(1);
  });

  test("matches requested type names case-insensitively", async () => {
    const client = listingClient();
    client.listTailorDBTypes.mockResolvedValueOnce(namesResult("Project"));

    const result = await resolveTableNamespaces({
      workspaceId: "workspace-id",
      namespaces: ["main"],
      tableNames: ["project"],
      client,
    });

    expect(result.get("project")).toEqual(["main"]);
  });
});

describe("resolveUniqueTableNamespaces", () => {
  test("resolves each table to its one namespace and leaves out tables no namespace has", async () => {
    const client = listingClient();
    client.listTailorDBTypes
      .mockResolvedValueOnce(namesResult("User"))
      .mockResolvedValueOnce(namesResult("Event"));

    const result = await resolveUniqueTableNamespaces({
      workspaceId: "workspace-id",
      namespaces: ["main", "analytics"],
      tableNames: ["User", "Missing"],
      client,
    });

    expect(result).toEqual(new Map([["User", "main"]]));
  });

  test("rejects a table that several namespaces have", async () => {
    const client = listingClient();
    client.listTailorDBTypes
      .mockResolvedValueOnce(namesResult("User"))
      .mockResolvedValueOnce(namesResult("User"));

    await expect(
      resolveUniqueTableNamespaces({
        workspaceId: "workspace-id",
        namespaces: ["main", "analytics"],
        tableNames: ["User"],
        client,
      }),
    ).rejects.toMatchObject({
      code: "TAILORDB_TABLE_NAMESPACE_AMBIGUOUS",
      suggestion: expect.stringContaining("--namespace"),
      context: { tables: [{ table: "User", namespaces: ["main", "analytics"] }] },
    });
  });
});
