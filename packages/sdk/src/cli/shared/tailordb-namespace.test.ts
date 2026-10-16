import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, test, vi } from "vitest";
import { MAX_PAGE_SIZE } from "./client";
import { resolveTypeNamespace, resolveTypeNamespaces } from "./tailordb-namespace";

const namesResult = (...names: string[]) => ({
  tailordbTypes: names.map((name) => ({ name })),
  nextPageToken: "",
});

describe("resolveTypeNamespaces", () => {
  test("resolves multiple types from different namespaces", async () => {
    const client = {
      listTailorDBTypes: vi
        .fn()
        .mockResolvedValueOnce(namesResult("User"))
        .mockResolvedValueOnce(namesResult("Event")),
    };

    const result = await resolveTypeNamespaces({
      workspaceId: "workspace-id",
      namespaces: ["main", "analytics"],
      typeNames: ["User", "Event"],
      client,
    });

    expect(result.get("User")).toBe("main");
    expect(result.get("Event")).toBe("analytics");
  });

  test("resolves types listed on every page", async () => {
    const client = {
      listTailorDBTypes: vi
        .fn()
        .mockResolvedValueOnce({ tailordbTypes: [{ name: "User" }], nextPageToken: "page-2" })
        .mockResolvedValueOnce(namesResult("Order")),
    };

    const result = await resolveTypeNamespaces({
      workspaceId: "workspace-id",
      namespaces: ["main"],
      typeNames: ["User", "Order"],
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

  test("propagates a failure to list a namespace's types, including NotFound", async () => {
    const listError = new ConnectError("workspace not found", Code.NotFound);
    const client = {
      listTailorDBTypes: vi
        .fn()
        .mockRejectedValueOnce(listError)
        .mockResolvedValueOnce(namesResult("User")),
    };

    await expect(
      resolveTypeNamespaces({
        workspaceId: "workspace-id",
        namespaces: ["main", "analytics"],
        typeNames: ["User"],
        client,
      }),
    ).rejects.toBe(listError);
    expect(client.listTailorDBTypes).toHaveBeenCalledTimes(1);
  });

  test("stops querying when all types are resolved", async () => {
    const client = { listTailorDBTypes: vi.fn().mockResolvedValueOnce(namesResult("User")) };

    await resolveTypeNamespaces({
      workspaceId: "workspace-id",
      namespaces: ["main", "analytics"],
      typeNames: ["User"],
      client,
    });

    expect(client.listTailorDBTypes).toHaveBeenCalledTimes(1);
  });

  test("stops paging a namespace once every type is resolved", async () => {
    const client = {
      listTailorDBTypes: vi
        .fn()
        .mockResolvedValueOnce({ tailordbTypes: [{ name: "User" }], nextPageToken: "page-2" })
        .mockRejectedValueOnce(new ConnectError("transient failure", Code.Unavailable)),
    };

    const result = await resolveTypeNamespaces({
      workspaceId: "workspace-id",
      namespaces: ["main"],
      typeNames: ["User"],
      client,
    });

    expect(result.get("User")).toBe("main");
    expect(client.listTailorDBTypes).toHaveBeenCalledTimes(1);
  });

  test("matches requested type names case-insensitively", async () => {
    const client = { listTailorDBTypes: vi.fn().mockResolvedValueOnce(namesResult("Project")) };

    const result = await resolveTypeNamespaces({
      workspaceId: "workspace-id",
      namespaces: ["main"],
      typeNames: ["project"],
      client,
    });

    expect(result.get("project")).toBe("main");
  });
});

describe("resolveTypeNamespace", () => {
  test("returns null when the type is not found", async () => {
    const client = { listTailorDBTypes: vi.fn().mockResolvedValue(namesResult("Order")) };

    const result = await resolveTypeNamespace({
      workspaceId: "workspace-id",
      namespaces: ["main"],
      typeName: "User",
      client,
    });

    expect(result).toBeNull();
  });
});
