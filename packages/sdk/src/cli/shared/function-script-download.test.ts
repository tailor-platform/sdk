import { FunctionExecution_Type } from "@tailor-proto/tailor/v1/function_resource_pb";
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
  test("concatenates chunks into a UTF-8 string", async () => {
    const client = makeStreamingClient([
      { payload: { case: "chunk", value: new TextEncoder().encode("hello, ") } },
      { payload: { case: "chunk", value: new TextEncoder().encode("world") } },
    ]);

    const result = await downloadFunctionScript({
      client,
      workspaceId: "ws-1",
      name: "my-fn",
    });

    expect(result).toEqual({ code: "hello, world" });
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
    expect(
      scriptNameToRegistryName("my-resolver.throwError.body.js", FunctionExecution_Type.STANDARD),
    ).toBe("resolver--my-resolver--throwError");
  });

  test("preserves dots in resolver name (non-greedy namespace)", () => {
    // namespace must not contain dots; resolver name may contain dots
    expect(scriptNameToRegistryName("ns.foo.bar.body.js", FunctionExecution_Type.STANDARD)).toBe(
      "resolver--ns--foo.bar",
    );
  });

  test("translates executor scriptName to registry name", () => {
    expect(
      scriptNameToRegistryName("user-changed.operation.js", FunctionExecution_Type.STANDARD),
    ).toBe("executor--user-changed");
  });

  test("translates auth hook scriptName to registry name", () => {
    expect(
      scriptNameToRegistryName("my-auth.before-login.hook.js", FunctionExecution_Type.STANDARD),
    ).toBe("auth-hook--my-auth--before-login");
  });

  test("translates workflow job scriptName (no dots) under JOB type", () => {
    expect(scriptNameToRegistryName("validate-order", FunctionExecution_Type.JOB)).toBe(
      "workflow--validate-order",
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

  test("returns null for ad-hoc test-run scripts under STANDARD type", () => {
    expect(
      scriptNameToRegistryName("test-run--throwError.js", FunctionExecution_Type.STANDARD),
    ).toBeNull();
  });

  test("returns null for seed scripts under STANDARD type", () => {
    expect(
      scriptNameToRegistryName("seed-tailordb.ts", FunctionExecution_Type.STANDARD),
    ).toBeNull();
  });

  test("returns null for query scripts under STANDARD type", () => {
    expect(scriptNameToRegistryName("query-gql.js", FunctionExecution_Type.STANDARD)).toBeNull();
    expect(
      scriptNameToRegistryName("query-sql-tailordb.js", FunctionExecution_Type.STANDARD),
    ).toBeNull();
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
