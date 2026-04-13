import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { describe, test, expect, vi } from "vitest";
import { downloadFunctionScript, scriptNameToRegistryName } from "./function-script-download";
import type { OperatorClient } from "@/cli/shared/client";

interface DownloadResponse {
  payload:
    | { case: "metadata"; value: unknown }
    | { case: "chunk"; value: Uint8Array }
    | { case: undefined; value?: undefined };
}

function makeStreamingClient(responses: DownloadResponse[]): OperatorClient {
  return {
    downloadFunctionRegistryScript: vi.fn(async function* () {
      for (const r of responses) {
        yield r;
      }
    }),
  } as unknown as OperatorClient;
}

describe("downloadFunctionScript", () => {
  test("concatenates chunks into a UTF-8 string and returns registry updatedAt", async () => {
    const updatedAt = new Date("2024-03-01T00:00:00Z");
    const client = makeStreamingClient([
      {
        payload: {
          case: "metadata",
          value: { function: { updatedAt: timestampFromDate(updatedAt) } },
        },
      },
      { payload: { case: "chunk", value: new TextEncoder().encode("hello, ") } },
      { payload: { case: "chunk", value: new TextEncoder().encode("world") } },
    ]);

    const result = await downloadFunctionScript({
      client,
      workspaceId: "ws-1",
      name: "my-fn",
    });

    expect(result).toEqual({ code: "hello, world", registryUpdatedAt: updatedAt });
  });

  test("returns registryUpdatedAt as null when metadata omits the timestamp", async () => {
    const client = makeStreamingClient([
      { payload: { case: "metadata", value: {} } },
      { payload: { case: "chunk", value: new TextEncoder().encode("x") } },
    ]);

    const result = await downloadFunctionScript({
      client,
      workspaceId: "ws-1",
      name: "my-fn",
    });

    expect(result).toEqual({ code: "x", registryUpdatedAt: null });
  });

  test("returns null when no chunks are received", async () => {
    const client = makeStreamingClient([{ payload: { case: "metadata", value: {} } }]);

    const result = await downloadFunctionScript({
      client,
      workspaceId: "ws-1",
      name: "my-fn",
    });

    expect(result).toBeNull();
  });

  test("returns null when the streaming RPC throws", async () => {
    const client = {
      downloadFunctionRegistryScript: vi.fn(() => {
        throw new Error("not found");
      }),
    } as unknown as OperatorClient;

    const result = await downloadFunctionScript({
      client,
      workspaceId: "ws-1",
      name: "missing-fn",
    });

    expect(result).toBeNull();
  });

  test("forwards translated registry name to the RPC request", async () => {
    // Caller is expected to translate scriptName → registryName via
    // scriptNameToRegistryName before calling. This test verifies the
    // raw `name` field is forwarded as-is so the translation contract
    // is enforced at the call site.
    const fn = vi.fn(async function* () {
      yield { payload: { case: "chunk" as const, value: new TextEncoder().encode("x") } };
    });
    const client = { downloadFunctionRegistryScript: fn } as unknown as OperatorClient;

    await downloadFunctionScript({
      client,
      workspaceId: "ws-1",
      name: "resolver--ns--myFn",
    });

    expect(fn).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      name: "resolver--ns--myFn",
      contentHash: undefined,
    });
  });

  test("forwards contentHash to the RPC request", async () => {
    const fn = vi.fn(async function* () {
      yield { payload: { case: "chunk" as const, value: new TextEncoder().encode("x") } };
    });
    const client = { downloadFunctionRegistryScript: fn } as unknown as OperatorClient;

    await downloadFunctionScript({
      client,
      workspaceId: "ws-1",
      name: "my-fn",
      contentHash: "abc123",
    });

    expect(fn).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      name: "my-fn",
      contentHash: "abc123",
    });
  });
});

describe("scriptNameToRegistryName", () => {
  test("translates resolver scriptName to registry name", () => {
    expect(scriptNameToRegistryName("my-resolver.throwError.body.js")).toBe(
      "resolver--my-resolver--throwError",
    );
  });

  test("preserves dots in resolver name (non-greedy namespace)", () => {
    // namespace must not contain dots; resolver name may contain dots
    expect(scriptNameToRegistryName("ns.foo.bar.body.js")).toBe("resolver--ns--foo.bar");
  });

  test("translates executor scriptName to registry name", () => {
    expect(scriptNameToRegistryName("user-changed.operation.js")).toBe("executor--user-changed");
  });

  test("translates auth hook scriptName to registry name", () => {
    expect(scriptNameToRegistryName("my-auth.before-login.hook.js")).toBe(
      "auth-hook--my-auth--before-login",
    );
  });

  test("translates workflow job scriptName (no extension) to registry name", () => {
    expect(scriptNameToRegistryName("validate-order")).toBe("workflow--validate-order");
  });

  test("returns null for ad-hoc test-run scripts", () => {
    expect(scriptNameToRegistryName("test-run--throwError.js")).toBeNull();
  });

  test("returns null for seed scripts", () => {
    expect(scriptNameToRegistryName("seed-tailordb.ts")).toBeNull();
  });

  test("returns null for query scripts", () => {
    expect(scriptNameToRegistryName("query-gql.js")).toBeNull();
    expect(scriptNameToRegistryName("query-sql-tailordb.js")).toBeNull();
  });
});
