import * as fs from "node:fs";
import * as path from "node:path";
import { Code, ConnectError, type UnaryRequest } from "@connectrpc/connect";
import { OperatorService } from "@tailor-platform/tailor-proto/service_pb";
import { afterEach, beforeEach, describe, test, expect, vi } from "vitest";
import { reportCrash } from "#/cli/crashreport/index";
import {
  concurrencyLimitInterceptor,
  createTransport,
  fetchAll,
  fetchPaged,
  formatRequestParams,
  getConsoleBaseUrl,
  initOperatorClient,
  MAX_PAGE_SIZE,
  parseMethodName,
  rememberPlatformConfigForToken,
  resolveStaticWebsiteUrls,
  RETRY_SAFE_CREATE_METHODS,
  retryInterceptor,
  type OperatorClient,
} from "./client";
import { logger } from "./logger";

vi.mock("@connectrpc/connect-node", () => ({
  createConnectTransport: vi.fn(() => ({ type: "node-transport" })),
}));

vi.mock("#/cli/crashreport/index", () => ({
  reportCrash: vi.fn(),
}));

describe("createTransport", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("uses connect-node transport with HTTP/2", async () => {
    const transport = await createTransport("https://example.com", []);
    const connectNode = await import("@connectrpc/connect-node");
    expect(connectNode.createConnectTransport).toHaveBeenCalledWith({
      httpVersion: "2",
      baseUrl: "https://example.com",
      interceptors: [],
    });
    expect(transport).toEqual({ type: "node-transport" });
  });
});

describe("initOperatorClient", () => {
  afterEach(() => {
    rememberPlatformConfigForToken("token-a");
    vi.clearAllMocks();
  });

  test("uses the platform config remembered for the access token", async () => {
    rememberPlatformConfigForToken("token-a", {
      platformUrl: "https://api.dev.tailor.tech",
    });

    await initOperatorClient("token-a");
    const connectNode = await import("@connectrpc/connect-node");

    expect(connectNode.createConnectTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "https://api.dev.tailor.tech",
      }),
    );
  });
});

describe("getConsoleBaseUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("infers the Console URL from profile platform URL before using env console URL", () => {
    vi.stubEnv("PLATFORM_CONSOLE_URL", "https://console.other.tailor.tech");

    expect(getConsoleBaseUrl({ platformUrl: "https://api.dev.tailor.tech" })).toBe(
      "https://console.dev.tailor.tech",
    );
  });
});

describe("fetchAll", () => {
  test("passes MAX_PAGE_SIZE to callback", async () => {
    const fn = vi.fn().mockResolvedValue([["item1"], ""]);

    await fetchAll(fn);

    expect(fn).toHaveBeenCalledWith("", MAX_PAGE_SIZE);
  });
});

describe("fetchPaged", () => {
  test("returns every page when limit is undefined", async () => {
    const fn = vi
      .fn()
      .mockResolvedValueOnce([["a", "b"], "next"])
      .mockResolvedValueOnce([["c"], ""]);

    const items = await fetchPaged(fn);

    expect(items).toEqual(["a", "b", "c"]);
    expect(fn).toHaveBeenNthCalledWith(1, "", MAX_PAGE_SIZE);
    expect(fn).toHaveBeenNthCalledWith(2, "next", MAX_PAGE_SIZE);
  });

  test("treats limit 0 as unlimited", async () => {
    const fn = vi
      .fn()
      .mockResolvedValueOnce([["a", "b"], "next"])
      .mockResolvedValueOnce([["c"], ""]);

    const items = await fetchPaged(fn, { limit: 0 });

    expect(items).toEqual(["a", "b", "c"]);
    expect(fn).toHaveBeenNthCalledWith(1, "", MAX_PAGE_SIZE);
  });

  test("stops fetching once limit is reached and slices overflow", async () => {
    const fn = vi
      .fn()
      .mockResolvedValueOnce([["a", "b", "c", "d"], "next"])
      .mockResolvedValueOnce([["e"], ""]);

    const items = await fetchPaged(fn, { limit: 3 });

    expect(items).toEqual(["a", "b", "c"]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("", 3);
  });

  test("requests smaller pages as it approaches the limit", async () => {
    const fn = vi
      .fn()
      .mockResolvedValueOnce([Array.from({ length: MAX_PAGE_SIZE }, () => "x"), "next"])
      .mockResolvedValueOnce([["y", "y", "y"], ""]);

    const items = await fetchPaged(fn, { limit: MAX_PAGE_SIZE + 5 });

    expect(items).toHaveLength(MAX_PAGE_SIZE + 3);
    expect(fn).toHaveBeenNthCalledWith(1, "", MAX_PAGE_SIZE);
    expect(fn).toHaveBeenNthCalledWith(2, "next", 5);
  });

  test("exits when the server returns no next page token", async () => {
    const fn = vi.fn().mockResolvedValue([["only"], ""]);

    const items = await fetchPaged(fn, { limit: 100 });

    expect(items).toEqual(["only"]);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("retryInterceptor", () => {
  // Stub timers so the real backoff (500ms base) does not slow the suite or make
  // it flaky under load; runAllTimersAsync below drives the awaited setTimeout.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(reportCrash).mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Build a minimal unary request bound to a real OperatorService method so the
   * interceptor can read `method.name`/`method.output`/`method.idempotency`.
   * @param method - OperatorService method descriptor to bind the request to
   * @returns A minimal unary request usable by the interceptor under test
   */
  function makeUnaryReq(
    method: (typeof OperatorService.method)[keyof typeof OperatorService.method],
  ) {
    return {
      stream: false,
      service: OperatorService,
      method,
      header: new Headers(),
      message: {},
    } as unknown as UnaryRequest;
  }

  /**
   * Drive the interceptor promise to completion under fake timers by flushing all
   * pending backoff timers (and the microtasks they unblock).
   *
   * A handler is attached synchronously (before advancing timers) so a rejection
   * that lands while timers are flushing is never momentarily unhandled — vitest
   * fails the run on unhandled rejections, and `settle` is used by tests that
   * expect rejection. The original error is rethrown so `.rejects` still works.
   * @param promise - The pending interceptor result
   * @returns The settled interceptor result
   */
  async function settle<T>(promise: Promise<T>): Promise<T> {
    const guarded = promise.then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    await vi.runAllTimersAsync();
    const result = await guarded;
    if (result.ok) return result.value;
    throw result.error;
  }

  const okResponse = { stream: false, message: {} };

  test("retries on Unavailable then succeeds", async () => {
    const next = vi
      .fn()
      .mockRejectedValueOnce(new ConnectError("unavailable", Code.Unavailable))
      .mockResolvedValueOnce(okResponse);

    const res = await settle(
      retryInterceptor()(next)(makeUnaryReq(OperatorService.method.createTailorDBType)),
    );

    expect(res).toBe(okResponse);
    expect(next).toHaveBeenCalledTimes(2);
  });

  test("treats AlreadyExists after a retry as success for Create methods", async () => {
    // #1350: prior attempt landed server-side but came back Unavailable; the
    // identical retry then hits already_exists on the _file metadata table.
    const next = vi
      .fn()
      .mockRejectedValueOnce(new ConnectError("unavailable", Code.Unavailable))
      .mockRejectedValueOnce(new ConnectError("duplicated key not allowed", Code.AlreadyExists));

    const res = await settle(
      retryInterceptor()(next)(makeUnaryReq(OperatorService.method.createTailorDBType)),
    );

    expect(next).toHaveBeenCalledTimes(2);
    expect(res.stream).toBe(false);
    // A synthesized empty output message stands in for the already-applied state.
    expect((res as { message: unknown }).message).toBeTruthy();
  });

  test("does not swallow a first-attempt AlreadyExists (genuine conflict)", async () => {
    const next = vi
      .fn()
      .mockRejectedValueOnce(new ConnectError("already exists", Code.AlreadyExists));

    await expect(
      settle(retryInterceptor()(next)(makeUnaryReq(OperatorService.method.createTailorDBType))),
    ).rejects.toThrow("already exists");
    expect(next).toHaveBeenCalledTimes(1);
  });

  test("does not treat AlreadyExists as success for non-Create methods", async () => {
    const next = vi
      .fn()
      .mockRejectedValueOnce(new ConnectError("unavailable", Code.Unavailable))
      .mockRejectedValueOnce(new ConnectError("already exists", Code.AlreadyExists));

    await expect(
      settle(retryInterceptor()(next)(makeUnaryReq(OperatorService.method.updateTailorDBType))),
    ).rejects.toThrow("already exists");
    expect(next).toHaveBeenCalledTimes(2);
  });

  test("does not swallow AlreadyExists for Create methods outside the allowlist", async () => {
    // createIdPClient consumes its response body (clientSecret), so an empty
    // synthesized response would corrupt downstream state — it must surface.
    const next = vi
      .fn()
      .mockRejectedValueOnce(new ConnectError("unavailable", Code.Unavailable))
      .mockRejectedValueOnce(new ConnectError("already exists", Code.AlreadyExists));

    await expect(
      settle(retryInterceptor()(next)(makeUnaryReq(OperatorService.method.createIdPClient))),
    ).rejects.toThrow("already exists");
    expect(next).toHaveBeenCalledTimes(2);
  });

  test("routes a first-attempt AlreadyExists from a retry-safe create to error tracking, then surfaces it", async () => {
    const next = vi
      .fn()
      .mockRejectedValueOnce(new ConnectError("duplicated key not allowed", Code.AlreadyExists));

    await expect(
      settle(retryInterceptor()(next)(makeUnaryReq(OperatorService.method.createTailorDBType))),
    ).rejects.toThrow("duplicated key not allowed");
    expect(vi.mocked(reportCrash)).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test("swallows a post-retry AlreadyExists without routing to error tracking", async () => {
    const next = vi
      .fn()
      .mockRejectedValueOnce(new ConnectError("resource exhausted", Code.ResourceExhausted))
      .mockRejectedValueOnce(new ConnectError("duplicated key not allowed", Code.AlreadyExists));

    const res = await settle(
      retryInterceptor()(next)(makeUnaryReq(OperatorService.method.createTailorDBType)),
    );

    expect(res.stream).toBe(false);
    expect(vi.mocked(reportCrash)).not.toHaveBeenCalled();
  });

  test("does not retry streaming requests", async () => {
    const streamRes = { stream: true };
    const next = vi.fn().mockResolvedValueOnce(streamRes);

    const req = {
      stream: true,
      method: OperatorService.method.createTailorDBType,
    } as unknown as UnaryRequest;
    const res = await settle(retryInterceptor()(next)(req));

    expect(res).toBe(streamRes);
    expect(next).toHaveBeenCalledTimes(1);
  });

  // Drift guard: every Create RPC invoked in the deploy/apply flow must be
  // consciously classified — either retry-safe (response unused, in
  // RETRY_SAFE_CREATE_METHODS) or explicitly exempt below. A newly added apply
  // create then fails this test until classified, instead of silently missing
  // the allowlist in production.
  test("RETRY_SAFE_CREATE_METHODS covers every deploy Create or it is explicitly exempt", () => {
    // Creates intentionally NOT treated as retry-safe:
    const EXEMPT_DEPLOY_CREATES = new Set([
      "CreateIdPClient", // consumes resp.client.clientSecret
      "CreateWorkflowJobFunction", // consumes response.jobFunction.version
      "CreateFunctionRegistry", // client-streaming: bypasses the retry loop
    ]);

    const deployDir = path.resolve(import.meta.dirname, "../commands/deploy");
    const tsFiles: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts") && !entry.name.includes(".test.")) tsFiles.push(full);
      }
    };
    walk(deployDir);

    const used = new Set<string>();
    const callRe = /client\.(create[A-Z][A-Za-z0-9]*)\s*\(/g;
    for (const file of tsFiles) {
      const src = fs.readFileSync(file, "utf8");
      for (const m of src.matchAll(callRe)) {
        const local = m[1]!;
        used.add(local.charAt(0).toUpperCase() + local.slice(1));
      }
    }

    // Sanity: the scan actually found deploy creates (guards against a broken regex/path).
    expect(used.has("CreateTailorDBType")).toBe(true);

    const unclassified = [...used].filter(
      (name) => !RETRY_SAFE_CREATE_METHODS.has(name) && !EXEMPT_DEPLOY_CREATES.has(name),
    );
    // On failure the diff lists the offending method(s). Each must be added to
    // RETRY_SAFE_CREATE_METHODS (if its response body is unused) or to
    // EXEMPT_DEPLOY_CREATES (if its response is consumed / it is streaming).
    expect(unclassified).toEqual([]);
  });

  test("every RETRY_SAFE_CREATE_METHODS entry is a real OperatorService method", () => {
    const realCreateNames = new Set(
      Object.values(OperatorService.method)
        .map((m) => m.name)
        .filter((name) => name.startsWith("Create")),
    );
    // On failure the diff lists the unknown name(s) — fix the typo/rename in
    // RETRY_SAFE_CREATE_METHODS to match the OperatorService method name.
    const typos = [...RETRY_SAFE_CREATE_METHODS].filter((name) => !realCreateNames.has(name));
    expect(typos).toEqual([]);
  });
});

describe("concurrencyLimitInterceptor", () => {
  const original = process.env.TAILOR_APPLY_CONCURRENCY;
  afterEach(() => {
    if (original === undefined) {
      delete process.env.TAILOR_APPLY_CONCURRENCY;
    } else {
      process.env.TAILOR_APPLY_CONCURRENCY = original;
    }
  });

  const unaryReq = { stream: false } as unknown as UnaryRequest;
  const streamReq = { stream: true } as unknown as UnaryRequest;

  test("bounds the number of concurrent in-flight unary RPCs to the cap", async () => {
    process.env.TAILOR_APPLY_CONCURRENCY = "2";
    let active = 0;
    let peak = 0;
    const next = vi.fn(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      await Promise.resolve();
      active -= 1;
      return { stream: false, message: {} };
    });

    const handler = concurrencyLimitInterceptor()(next as never);
    await Promise.all(Array.from({ length: 8 }, () => handler(unaryReq)));

    expect(peak).toBeLessThanOrEqual(2);
    expect(next).toHaveBeenCalledTimes(8);
  });

  test("does not gate streaming requests even when the unary cap is saturated", async () => {
    process.env.TAILOR_APPLY_CONCURRENCY = "1";

    let releaseUnary: () => void = () => {};
    const blocked = new Promise<void>((resolve) => {
      releaseUnary = resolve;
    });
    const next = vi.fn(async (req: { stream: boolean }) => {
      if (!req.stream) await blocked;
      return { stream: req.stream, message: {} };
    });

    const handler = concurrencyLimitInterceptor()(next as never);
    // Saturate the single unary slot with a request that stays pending.
    const pendingUnary = handler(unaryReq);
    // A streaming request must still pass straight through to next().
    const streamResult = (await handler(streamReq)) as { stream: boolean };

    expect(streamResult.stream).toBe(true);
    releaseUnary();
    await pendingUnary;
  });
});

describe("parseMethodName", () => {
  test("parses Create methods", () => {
    expect(parseMethodName("CreateWorkflow")).toEqual({
      operation: "create",
      resourceType: "Workflow",
    });
    expect(parseMethodName("CreateTailorDBService")).toEqual({
      operation: "create",
      resourceType: "TailorDBService",
    });
    expect(parseMethodName("CreateTailorDBType")).toEqual({
      operation: "create",
      resourceType: "TailorDBType",
    });
  });

  test("parses Update methods", () => {
    expect(parseMethodName("UpdateWorkflow")).toEqual({
      operation: "update",
      resourceType: "Workflow",
    });
    expect(parseMethodName("UpdateTailorDBType")).toEqual({
      operation: "update",
      resourceType: "TailorDBType",
    });
  });

  test("parses Delete methods", () => {
    expect(parseMethodName("DeleteWorkflow")).toEqual({
      operation: "delete",
      resourceType: "Workflow",
    });
    expect(parseMethodName("DeleteExecutorExecutor")).toEqual({
      operation: "delete",
      resourceType: "ExecutorExecutor",
    });
  });

  test("parses Set methods", () => {
    expect(parseMethodName("SetMetadata")).toEqual({
      operation: "set",
      resourceType: "Metadata",
    });
  });

  test("parses List methods", () => {
    expect(parseMethodName("ListWorkflows")).toEqual({
      operation: "list",
      resourceType: "Workflows",
    });
    expect(parseMethodName("ListWorkflowJobFunctions")).toEqual({
      operation: "list",
      resourceType: "WorkflowJobFunctions",
    });
  });

  test("parses Get methods", () => {
    expect(parseMethodName("GetStaticWebsite")).toEqual({
      operation: "get",
      resourceType: "StaticWebsite",
    });
  });

  test("returns default for unknown method patterns", () => {
    expect(parseMethodName("UnknownMethod")).toEqual({
      operation: "perform",
      resourceType: "resource",
    });
    expect(parseMethodName("")).toEqual({
      operation: "perform",
      resourceType: "resource",
    });
  });
});

describe("formatRequestParams", () => {
  test("serializes plain objects to JSON", () => {
    const obj = { workspaceId: "test-id", name: "test-name" };
    const result = formatRequestParams(obj);
    expect(result).toBe(JSON.stringify(obj, null, 2));
  });

  test("uses toJson method if available (protobuf messages)", () => {
    const protoMessage = {
      workspaceId: "test-id",
      name: "test-name",
      toJson: () => ({ workspaceId: "test-id", name: "test-name" }),
    };
    const result = formatRequestParams(protoMessage);
    expect(result).toBe(JSON.stringify({ workspaceId: "test-id", name: "test-name" }, null, 2));
  });

  test("handles null and undefined", () => {
    expect(formatRequestParams(null)).toBe("null");
    expect(formatRequestParams(undefined)).toBe(undefined);
  });

  test("handles arrays", () => {
    const arr = [1, 2, 3];
    expect(formatRequestParams(arr)).toBe(JSON.stringify(arr, null, 2));
  });

  test("handles primitive values", () => {
    expect(formatRequestParams("string")).toBe('"string"');
    expect(formatRequestParams(123)).toBe("123");
    expect(formatRequestParams(true)).toBe("true");
  });

  test("returns error message for circular references", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(formatRequestParams(circular)).toBe("(unable to serialize request)");
  });

  test("returns error message when toJson throws", () => {
    const badProto = {
      toJson: () => {
        throw new Error("serialization failed");
      },
    };
    expect(formatRequestParams(badProto)).toBe("(unable to serialize request)");
  });

  test("serializes objects containing BigInt values", () => {
    const objWithBigInt = {
      workspaceId: "test-id",
      duration: { seconds: BigInt(3600), nanos: 0 },
    };
    const result = formatRequestParams(objWithBigInt);
    expect(result).toContain('"seconds": "3600"');
    expect(result).toContain('"nanos": 0');
  });

  test("serializes nested BigInt values in toJson result", () => {
    const protoWithBigInt = {
      toJson: () => ({
        accessTokenLifetime: { seconds: BigInt(86400), nanos: 0 },
      }),
    };
    const result = formatRequestParams(protoWithBigInt);
    expect(result).toContain('"seconds": "86400"');
  });
});

describe("resolveStaticWebsiteUrls", () => {
  function makeClient(
    impl: (name: string) => Promise<{ staticwebsite?: { url?: string } }>,
  ): OperatorClient {
    return {
      getStaticWebsite: vi.fn(({ name }: { name: string }) => impl(name)),
    } as unknown as OperatorClient;
  }

  test("resolves :url patterns to fetched URLs", async () => {
    const client = makeClient(async () => ({ staticwebsite: { url: "https://site.example.com" } }));

    const resolved = await resolveStaticWebsiteUrls(
      client,
      "ws-1",
      ["my-site:url", "my-site:url/callback", "https://literal.example.com"],
      "CORS",
    );

    expect(resolved).toEqual([
      "https://site.example.com",
      "https://site.example.com/callback",
      "https://literal.example.com",
    ]);
  });

  test("warns and drops entry when site is missing and not expected locally", async () => {
    using warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const client = makeClient(async () => {
      throw new ConnectError("not found", Code.NotFound);
    });

    const resolved = await resolveStaticWebsiteUrls(client, "ws-1", ["unknown:url"], "CORS");

    expect(resolved).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      'Static website "unknown" not found for CORS configuration. Excluding from CORS.',
    );
  });

  test("suppresses warning and keeps original pattern when site is expected locally", async () => {
    using warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const client = makeClient(async () => {
      throw new ConnectError("not found", Code.NotFound);
    });

    const resolved = await resolveStaticWebsiteUrls(
      client,
      "ws-1",
      ["my-site:url", "my-site:url/callback"],
      "CORS",
      { expectedLocalNames: new Set(["my-site"]) },
    );

    expect(resolved).toEqual(["my-site:url", "my-site:url/callback"]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("still warns when URL is not assigned yet, even when site is expected locally", async () => {
    using warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const client = makeClient(async () => ({ staticwebsite: { url: "" } }));

    const resolved = await resolveStaticWebsiteUrls(client, "ws-1", ["my-site:url"], "CORS", {
      expectedLocalNames: new Set(["my-site"]),
    });

    expect(resolved).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      'Static website "my-site" has no URL assigned yet. Excluding from CORS.',
    );
  });

  test("does not suppress non-NotFound errors even when site is expected locally", async () => {
    using warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const client = makeClient(async () => {
      throw new ConnectError("service unavailable", Code.Unavailable);
    });

    const resolved = await resolveStaticWebsiteUrls(client, "ws-1", ["my-site:url"], "CORS", {
      expectedLocalNames: new Set(["my-site"]),
    });

    expect(resolved).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      'Static website "my-site" not found for CORS configuration. Excluding from CORS.',
    );
  });
});
