import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { FunctionExecution_Type } from "@tailor-platform/tailor-proto/function_resource_pb";
import { describe, test, expect, vi } from "vitest";
import { downloadFunctionScript, scriptNameToRegistryName } from "./function-script-download";
import type { OperatorClient } from "#/cli/shared/client";

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

function chunk(text: string): DownloadResponse {
  return { payload: { case: "chunk", value: new TextEncoder().encode(text) } };
}

async function download(
  client: OperatorClient,
  overrides: { name?: string; contentHash?: string } = {},
) {
  return downloadFunctionScript({
    client,
    workspaceId: "ws-1",
    name: overrides.name ?? "my-fn",
    contentHash: overrides.contentHash,
  });
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
      chunk("hello, "),
      chunk("world"),
    ]);

    const result = await download(client);

    expect(result).toEqual({ code: "hello, world", registryUpdatedAt: updatedAt });
  });

  test("returns registryUpdatedAt as null when metadata omits the timestamp", async () => {
    const client = makeStreamingClient([{ payload: { case: "metadata", value: {} } }, chunk("x")]);

    const result = await download(client);

    expect(result).toEqual({ code: "x", registryUpdatedAt: null });
  });

  test("returns null when no chunks are received", async () => {
    const client = makeStreamingClient([{ payload: { case: "metadata", value: {} } }]);

    expect(await download(client)).toBeNull();
  });

  test("returns null when the streaming RPC throws", async () => {
    const client = {
      downloadFunctionRegistryScript: vi.fn(() => {
        throw new Error("not found");
      }),
    } as unknown as OperatorClient;

    expect(await download(client, { name: "missing-fn" })).toBeNull();
  });

  test("forwards translated registry name to the RPC request", async () => {
    // Caller is expected to translate scriptName → registryName via
    // scriptNameToRegistryName before calling. This test verifies the
    // raw `name` field is forwarded as-is so the translation contract
    // is enforced at the call site.
    const client = makeStreamingClient([chunk("x")]);

    await download(client, { name: "resolver--ns--myFn" });

    expect(client.downloadFunctionRegistryScript).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      name: "resolver--ns--myFn",
      contentHash: undefined,
    });
  });

  test("forwards contentHash to the RPC request", async () => {
    const client = makeStreamingClient([chunk("x")]);

    await download(client, { contentHash: "abc123" });

    expect(client.downloadFunctionRegistryScript).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      name: "my-fn",
      contentHash: "abc123",
    });
  });
});

describe("scriptNameToRegistryName", () => {
  test.each([
    [
      "translates resolver scriptName to registry name",
      "my-resolver.throwError.body.js",
      FunctionExecution_Type.STANDARD,
      "resolver--my-resolver--throwError",
    ],
    [
      "translates executor scriptName to registry name",
      "user-changed.operation.js",
      FunctionExecution_Type.STANDARD,
      "executor--user-changed",
    ],
    [
      "translates auth hook scriptName to registry name",
      "my-auth.before-login.hook.js",
      FunctionExecution_Type.STANDARD,
      "auth-hook--my-auth--before-login",
    ],
    [
      "translates workflow job scriptName (no dots) under JOB type",
      "validate-order",
      FunctionExecution_Type.JOB,
      "workflow--validate-order",
    ],
  ])("%s", (_description, scriptName, type, expected) => {
    expect(scriptNameToRegistryName(scriptName, type)).toBe(expected);
  });

  test("preserves dots in resolver name (non-greedy namespace)", () => {
    // namespace must not contain dots; resolver name may contain dots
    expect(scriptNameToRegistryName("ns.foo.bar.body.js", FunctionExecution_Type.STANDARD)).toBe(
      "resolver--ns--foo.bar",
    );
  });

  test("translates workflow job scriptName that contains dots under JOB type", () => {
    // WorkflowJobSchema.name is an unconstrained string, so job names
    // may legitimately contain dots. The JOB type discriminator must
    // take precedence over any extension-based heuristic.
    expect(scriptNameToRegistryName("billing.retry.v2", FunctionExecution_Type.JOB)).toBe(
      "workflow--billing.retry.v2",
    );
    expect(
      scriptNameToRegistryName("looks-like-a-resolver.body.js", FunctionExecution_Type.JOB),
    ).toBe("workflow--looks-like-a-resolver.body.js");
  });

  test.each([
    ["ad-hoc test-run scripts", "test-run--throwError.js"],
    ["seed scripts", "seed-tailordb.ts"],
    ["query scripts", "query-gql.js"],
    ["query scripts", "query-sql-tailordb.js"],
  ])("returns null for %s under STANDARD type: %j", (_kind, scriptName) => {
    expect(scriptNameToRegistryName(scriptName, FunctionExecution_Type.STANDARD)).toBeNull();
  });

  test("falls back to extension parsing for UNSPECIFIED type (legacy servers)", () => {
    // Older servers may leave `type` as the proto-default UNSPECIFIED.
    // Continue using the filename suffix heuristic so registered
    // resolvers/executors/auth-hooks still map when type is missing.
    expect(
      scriptNameToRegistryName("my-resolver.fn.body.js", FunctionExecution_Type.UNSPECIFIED),
    ).toBe("resolver--my-resolver--fn");
    expect(
      scriptNameToRegistryName("user-changed.operation.js", FunctionExecution_Type.UNSPECIFIED),
    ).toBe("executor--user-changed");
  });

  test("falls back to workflow for bare names under UNSPECIFIED (legacy servers)", () => {
    // Without a reliable `type`, we can only assume bare-name
    // scriptNames are workflow jobs. Dotted job names cannot be
    // disambiguated from resolver/executor/seed scripts in this
    // branch and remain unsupported for legacy servers.
    expect(scriptNameToRegistryName("validate-order", FunctionExecution_Type.UNSPECIFIED)).toBe(
      "workflow--validate-order",
    );
  });
});
