import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, test, vi } from "vitest";
import {
  assertUniqueLocalTailorDBTypeNames,
  assertUniqueTailorDBTypeNamesWithExternal,
  fetchExternalTailorDBTypeNameSources,
} from "./type-name-validation";

type ListTailorDBTypesArgs = {
  namespaceName: string;
  pageToken?: string;
};

type ListTailorDBTypesResult = {
  tailordbTypes: Array<{ name: string }>;
  nextPageToken?: string;
};

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

  test("fetches external namespaces concurrently while keeping each namespace paginated", async () => {
    const pending = new Map<string, (result: ListTailorDBTypesResult) => void>();
    const client = {
      listTailorDBTypes: vi.fn((args: ListTailorDBTypesArgs) => {
        const key = `${args.namespaceName}:${args.pageToken ?? ""}`;
        return new Promise<ListTailorDBTypesResult>((resolve) => {
          pending.set(key, resolve);
        });
      }),
    };

    const promise = fetchExternalTailorDBTypeNameSources({
      client,
      workspaceId: "workspace-id",
      externalTailorDBNamespaces: ["shared-a", "shared-b"],
    });

    await vi.waitFor(() => {
      expect(pending.has("shared-a:")).toBe(true);
      expect(pending.has("shared-b:")).toBe(true);
    });
    expect(client.listTailorDBTypes).toHaveBeenCalledTimes(2);

    pending.get("shared-a:")?.({
      tailordbTypes: [{ name: "User" }],
      nextPageToken: "next",
    });

    await vi.waitFor(() => {
      expect(pending.has("shared-a:next")).toBe(true);
    });
    expect(client.listTailorDBTypes).toHaveBeenCalledTimes(3);

    pending.get("shared-a:next")?.({
      tailordbTypes: [{ name: "Order" }],
      nextPageToken: "",
    });
    pending.get("shared-b:")?.({
      tailordbTypes: [{ name: "Event" }],
      nextPageToken: "",
    });

    await expect(promise).resolves.toEqual([
      { namespace: "shared-a", typeName: "User", kind: "external" },
      { namespace: "shared-a", typeName: "Order", kind: "external" },
      { namespace: "shared-b", typeName: "Event", kind: "external" },
    ]);
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

  test("validates planned external namespaces without fetching remote types", async () => {
    const client = {
      listTailorDBTypes: vi.fn(),
    };

    await expect(
      assertUniqueTailorDBTypeNamesWithExternal({
        client,
        workspaceId: "workspace-id",
        tailorDBServices: [localService("local", ["User"])],
        externalTailorDBNamespaces: ["shared"],
        plannedExternalTailorDBServices: [localService("shared", ["User"])],
      }),
    ).rejects.toThrow(/namespace "local".*external namespace "shared"/);
    expect(client.listTailorDBTypes).not.toHaveBeenCalled();
  });
});
