import { Code, ConnectError } from "@connectrpc/connect";
import { PageDirection } from "@tailor-platform/tailor-proto/resource_pb";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import { mockOperatorClient } from "#/cli/shared/test-helpers/operator-client";
import { listFunctionRegistries } from "./list";
import type * as ClientModule from "#/cli/shared/client";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type { FunctionRegistrySchema } from "@tailor-platform/tailor-proto/function_registry_pb";

vi.mock("#/cli/shared/context", () => ({
  loadAccessToken: vi.fn(),
  loadWorkspaceId: vi.fn(),
}));

vi.mock("#/cli/shared/client", async () => {
  const actual = await vi.importActual<typeof ClientModule>("#/cli/shared/client");
  return {
    ...actual,
    initOperatorClient: vi.fn(),
  };
});

function fakeRegistry(name: string): MessageInitShape<typeof FunctionRegistrySchema> {
  return {
    name,
    description: "",
    sizeBytes: 0n,
    contentHash: "",
  };
}

function createClient() {
  return mockOperatorClient({ listFunctionRegistries: {} });
}

describe("listFunctionRegistries", () => {
  let client: ReturnType<typeof createClient>;

  aroundEach(async (runTest) => {
    vi.mocked(loadAccessToken).mockResolvedValue("mock-token");
    vi.mocked(loadWorkspaceId).mockResolvedValue("workspace-1");
    client = createClient();
    vi.mocked(initOperatorClient).mockResolvedValue(client);
    await runTest();
  });

  test.each([
    { order: "asc" as const, pageDirection: PageDirection.ASC },
    { order: "desc" as const, pageDirection: PageDirection.DESC },
    { order: undefined, pageDirection: undefined },
  ])(
    "passes pageDirection=$pageDirection when order is $order",
    async ({ order, pageDirection }) => {
      client.listFunctionRegistries.mockResolvedValue({
        functions: [fakeRegistry("a")],
        nextPageToken: "",
      });

      await listFunctionRegistries({ order });

      expect(client.listFunctionRegistries).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "workspace-1",
          sortBy: "updated_at",
          ...(pageDirection !== undefined && { pageDirection }),
        }),
      );
      expect(
        Object.hasOwn(client.listFunctionRegistries.mock.lastCall?.[0] ?? {}, "pageDirection"),
      ).toBe(pageDirection !== undefined);
    },
  );

  test("enforces limit across paginated calls", async () => {
    client.listFunctionRegistries
      .mockResolvedValueOnce({
        functions: [fakeRegistry("a"), fakeRegistry("b")],
        nextPageToken: "tok1",
      })
      .mockResolvedValueOnce({
        functions: [fakeRegistry("c"), fakeRegistry("d")],
        nextPageToken: "tok2",
      });

    const result = await listFunctionRegistries({ limit: 3 });

    expect(result).toHaveLength(3);
    expect(result.map((r) => r.name)).toEqual(["a", "b", "c"]);
  });

  test("returns empty list when server raises ConnectError NotFound", async () => {
    client.listFunctionRegistries.mockRejectedValue(new ConnectError("missing", Code.NotFound));

    const result = await listFunctionRegistries({});

    expect(result).toEqual([]);
  });

  test("propagates non-NotFound errors", async () => {
    client.listFunctionRegistries.mockRejectedValue(new ConnectError("boom", Code.Internal));

    await expect(listFunctionRegistries({})).rejects.toThrow(ConnectError);
  });
});
