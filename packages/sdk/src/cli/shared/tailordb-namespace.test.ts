import { describe, expect, test, vi } from "vitest";
import { resolveTypeNamespace, resolveTypeNamespaces } from "./tailordb-namespace";

const namesResult = (...names: string[]) => ({ tailordbTypes: names.map((name) => ({ name })) });

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

  test("continues when one namespace call fails", async () => {
    const client = {
      listTailorDBTypes: vi
        .fn()
        .mockRejectedValueOnce(new Error("failed"))
        .mockResolvedValueOnce(namesResult("User")),
    };

    const result = await resolveTypeNamespaces({
      workspaceId: "workspace-id",
      namespaces: ["main", "analytics"],
      typeNames: ["User"],
      client,
    });

    expect(result.get("User")).toBe("analytics");
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
