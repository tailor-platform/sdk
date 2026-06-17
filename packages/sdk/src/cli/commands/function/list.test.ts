import { Code, ConnectError } from "@connectrpc/connect";
import { PageDirection } from "@tailor-proto/tailor/v1/resource_pb";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#src/cli/shared/client";
import { loadAccessToken, loadWorkspaceId } from "#src/cli/shared/context";
import { listFunctionRegistries } from "./list";
import type * as ClientModule from "#src/cli/shared/client";

vi.mock("#src/cli/shared/context", () => ({
  loadAccessToken: vi.fn(),
  loadWorkspaceId: vi.fn(),
}));

vi.mock("#src/cli/shared/client", async () => {
  const actual = await vi.importActual<typeof ClientModule>("#src/cli/shared/client");
  return {
    ...actual,
    initOperatorClient: vi.fn(),
  };
});

function fakeRegistry(name: string) {
  return {
    name,
    description: "",
    sizeBytes: 0n,
    contentHash: "",
    createdAt: null,
    updatedAt: null,
  };
}

describe("listFunctionRegistries", () => {
  let listMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadAccessToken).mockResolvedValue("mock-token");
    vi.mocked(loadWorkspaceId).mockResolvedValue("workspace-1");
    listMock = vi.fn();
    vi.mocked(initOperatorClient).mockResolvedValue({
      listFunctionRegistries: listMock,
    } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);
  });

  test("passes pageDirection=ASC when order is 'asc'", async () => {
    listMock.mockResolvedValue({ functions: [fakeRegistry("a")], nextPageToken: "" });

    await listFunctionRegistries({ order: "asc" });

    expect(listMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-1",
        sortBy: "updated_at",
        pageDirection: PageDirection.ASC,
      }),
    );
  });

  test("passes pageDirection=DESC when order is 'desc'", async () => {
    listMock.mockResolvedValue({ functions: [], nextPageToken: "" });

    await listFunctionRegistries({ order: "desc" });

    expect(listMock).toHaveBeenCalledWith(
      expect.objectContaining({ pageDirection: PageDirection.DESC }),
    );
  });

  test("omits pageDirection when order is undefined", async () => {
    listMock.mockResolvedValue({ functions: [], nextPageToken: "" });

    await listFunctionRegistries({});

    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ pageDirection: undefined }));
  });

  test("enforces limit across paginated calls", async () => {
    listMock
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
    listMock.mockRejectedValue(new ConnectError("missing", Code.NotFound));

    const result = await listFunctionRegistries({});

    expect(result).toEqual([]);
  });

  test("propagates non-NotFound errors", async () => {
    listMock.mockRejectedValue(new ConnectError("boom", Code.Internal));

    await expect(listFunctionRegistries({})).rejects.toThrow(ConnectError);
  });
});
