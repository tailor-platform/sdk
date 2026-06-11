import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, test, vi } from "vitest";
import {
  assertUniqueLocalTailorDBTypeNames,
  assertUniqueTailorDBTypeNamesWithExternal,
  fetchExternalTailorDBTypeNameSources,
} from "./type-name-validation";

function localService(namespace: string, typeNames: string[]) {
  return {
    namespace,
    types: Object.fromEntries(typeNames.map((typeName) => [typeName, {}])),
    typeSourceInfo: Object.fromEntries(
      typeNames.map((typeName) => [
        typeName,
        {
          filePath: `/app/${namespace}/${typeName}.ts`,
          exportName: typeName.toLowerCase(),
        },
      ]),
    ),
  };
}

describe("assertUniqueLocalTailorDBTypeNames", () => {
  test("allows unique type names across local namespaces", () => {
    expect(() =>
      assertUniqueLocalTailorDBTypeNames({
        tailorDBServices: [localService("main", ["User"]), localService("analytics", ["Event"])],
      }),
    ).not.toThrow();
  });

  test("rejects duplicate type names across local namespaces", () => {
    expect(() =>
      assertUniqueLocalTailorDBTypeNames({
        tailorDBServices: [localService("main", ["User"]), localService("analytics", ["User"])],
      }),
    ).toThrow(/Duplicate TailorDB type names detected/);
    expect(() =>
      assertUniqueLocalTailorDBTypeNames({
        tailorDBServices: [localService("main", ["User"]), localService("analytics", ["User"])],
      }),
    ).toThrow(/namespace "main".*namespace "analytics"/);
  });
});

describe("fetchExternalTailorDBTypeNameSources", () => {
  test("fetches all pages for external namespaces", async () => {
    const client = {
      listTailorDBTypes: vi
        .fn()
        .mockResolvedValueOnce({
          tailordbTypes: [{ name: "User" }],
          nextPageToken: "next",
        })
        .mockResolvedValueOnce({
          tailordbTypes: [{ name: "Order" }],
          nextPageToken: "",
        }),
    };

    const result = await fetchExternalTailorDBTypeNameSources({
      client,
      workspaceId: "workspace-id",
      externalTailorDBNamespaces: ["shared"],
    });

    expect(result).toEqual([
      { namespace: "shared", typeName: "User", kind: "external" },
      { namespace: "shared", typeName: "Order", kind: "external" },
    ]);
    expect(client.listTailorDBTypes).toHaveBeenCalledTimes(2);
  });

  test("treats a missing external namespace as empty for validation", async () => {
    const client = {
      listTailorDBTypes: vi.fn().mockRejectedValue(new ConnectError("not found", Code.NotFound)),
    };

    const result = await fetchExternalTailorDBTypeNameSources({
      client,
      workspaceId: "workspace-id",
      externalTailorDBNamespaces: ["shared"],
    });

    expect(result).toEqual([]);
  });
});

describe("assertUniqueTailorDBTypeNamesWithExternal", () => {
  test("rejects duplicate type names between local and external namespaces", async () => {
    const client = {
      listTailorDBTypes: vi.fn().mockResolvedValue({
        tailordbTypes: [{ name: "User" }],
        nextPageToken: "",
      }),
    };

    await expect(
      assertUniqueTailorDBTypeNamesWithExternal({
        client,
        workspaceId: "workspace-id",
        tailorDBServices: [localService("main", ["User"])],
        externalTailorDBNamespaces: ["shared"],
      }),
    ).rejects.toThrow(/Type "User" is defined more than once/);
  });

  test("rejects duplicate type names between external namespaces", async () => {
    const client = {
      listTailorDBTypes: vi
        .fn()
        .mockResolvedValueOnce({
          tailordbTypes: [{ name: "User" }],
          nextPageToken: "",
        })
        .mockResolvedValueOnce({
          tailordbTypes: [{ name: "User" }],
          nextPageToken: "",
        }),
    };

    await expect(
      assertUniqueTailorDBTypeNamesWithExternal({
        client,
        workspaceId: "workspace-id",
        tailorDBServices: [],
        externalTailorDBNamespaces: ["shared-a", "shared-b"],
      }),
    ).rejects.toThrow(/external namespace "shared-a".*external namespace "shared-b"/);
  });
});
