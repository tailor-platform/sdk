import * as fs from "node:fs";
import * as path from "node:path";
import { MethodOptions_IdempotencyLevel } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, type UnaryRequest } from "@connectrpc/connect";
import { OperatorService } from "@tailor-platform/tailor-proto/service_pb";
import { aroundEach, describe, test, expect, vi } from "vitest";
import { reportCrash } from "#/cli/crashreport/index";
import {
  closeConnectionPool,
  concurrencyLimitInterceptor,
  createTransport,
  errorHandlingInterceptor,
  fetchAll,
  fetchAllTolerant,
  fetchMachineUserToken,
  fetchPaged,
  fetchPlatformMachineUserToken,
  getConsoleBaseUrl,
  getEffectivePlatformConfig,
  getOAuth2ClientId,
  getOrNull,
  getPlatformBaseUrl,
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

describe("client environment configuration", () => {
  aroundEach(async (runTest) => {
    await runTest();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  test("uses TAILOR_PLATFORM_URL for the platform base URL", async () => {
    vi.resetModules();
    vi.stubEnv("TAILOR_PLATFORM_URL", "https://api.staging.tailor.test");
    const client = await import("./client");
    expect(client.getPlatformBaseUrl()).toBe("https://api.staging.tailor.test");
  });
});

describe("createTransport", () => {
  aroundEach(async (runTest) => {
    await runTest();
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
  aroundEach(async (runTest) => {
    await runTest();
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
  aroundEach(async (runTest) => {
    await runTest();
    vi.unstubAllEnvs();
  });

  test("infers the Console URL from profile platform URL before using env console URL", () => {
    vi.stubEnv("TAILOR_PLATFORM_CONSOLE_URL", "https://console.other.tailor.tech");

    expect(getConsoleBaseUrl({ platformUrl: "https://api.dev.tailor.tech" })).toBe(
      "https://console.dev.tailor.tech",
    );
  });

  test("uses env console URL when profile platform URL cannot infer a custom Console URL", () => {
    vi.stubEnv("TAILOR_PLATFORM_CONSOLE_URL", "https://console.other.tailor.tech");

    expect(getConsoleBaseUrl({ platformUrl: "https://platform.dev.tailor.tech" })).toBe(
      "https://console.other.tailor.tech",
    );
  });
});

describe("platform environment variables", () => {
  aroundEach(async (runTest) => {
    await runTest();
    vi.unstubAllEnvs();
  });

  test("uses legacy platform env vars when renamed vars are absent", () => {
    vi.stubEnv("PLATFORM_URL", "https://api.legacy.tailor.tech");
    vi.stubEnv("PLATFORM_OAUTH2_CLIENT_ID", "legacy-client");

    expect(getPlatformBaseUrl()).toBe("https://api.legacy.tailor.tech");
    expect(getOAuth2ClientId()).toBe("legacy-client");
    expect(getEffectivePlatformConfig()).toEqual({
      platformUrl: "https://api.legacy.tailor.tech",
      oauth2ClientId: "legacy-client",
    });
  });

  test("prefers renamed platform env vars over legacy env vars", () => {
    vi.stubEnv("PLATFORM_URL", "https://api.legacy.tailor.tech");
    vi.stubEnv("PLATFORM_OAUTH2_CLIENT_ID", "legacy-client");
    vi.stubEnv("TAILOR_PLATFORM_URL", "https://api.dev.tailor.tech");
    vi.stubEnv("TAILOR_PLATFORM_OAUTH2_CLIENT_ID", "dev-client");

    expect(getPlatformBaseUrl()).toBe("https://api.dev.tailor.tech");
    expect(getOAuth2ClientId()).toBe("dev-client");
    expect(getEffectivePlatformConfig()).toEqual({
      platformUrl: "https://api.dev.tailor.tech",
      oauth2ClientId: "dev-client",
    });
  });
});

describe("fetchAll", () => {
  test("passes MAX_PAGE_SIZE to callback", async () => {
    const fn = vi.fn().mockResolvedValue([["item1"], ""]);

    await fetchAll(fn);

    expect(fn).toHaveBeenCalledWith("", MAX_PAGE_SIZE);
  });
});

describe("fetchAllTolerant", () => {
  test("returns every page when the fetcher succeeds", async () => {
    const fn = vi
      .fn()
      .mockResolvedValueOnce([["a"], "next"])
      .mockResolvedValueOnce([["b"], ""]);

    const items = await fetchAllTolerant(fn);

    expect(items).toEqual(["a", "b"]);
    expect(fn).toHaveBeenNthCalledWith(1, "", MAX_PAGE_SIZE);
    expect(fn).toHaveBeenNthCalledWith(2, "next", MAX_PAGE_SIZE);
  });

  test("returns an empty list when the fetcher raises NotFound", async () => {
    const fn = vi.fn().mockRejectedValue(new ConnectError("not found", Code.NotFound));

    await expect(fetchAllTolerant(fn)).resolves.toEqual([]);
  });

  test("keeps already fetched pages when a later page raises NotFound", async () => {
    const fn = vi
      .fn()
      .mockResolvedValueOnce([["a"], "next"])
      .mockRejectedValueOnce(new ConnectError("not found", Code.NotFound));

    await expect(fetchAllTolerant(fn)).resolves.toEqual(["a"]);
  });

  test("rethrows non-NotFound errors", async () => {
    const error = new ConnectError("unavailable", Code.Unavailable);
    const fn = vi.fn().mockRejectedValue(error);

    await expect(fetchAllTolerant(fn)).rejects.toBe(error);
  });
});

describe("getOrNull", () => {
  test("returns the fetched value when the getter succeeds", async () => {
    await expect(getOrNull(async () => ({ id: "item-1" }))).resolves.toEqual({ id: "item-1" });
  });

  test("returns undefined when the getter raises NotFound", async () => {
    await expect(
      getOrNull(async () => {
        throw new ConnectError("not found", Code.NotFound);
      }),
    ).resolves.toBeUndefined();
  });

  test("rethrows non-NotFound errors", async () => {
    const error = new ConnectError("unavailable", Code.Unavailable);

    await expect(
      getOrNull(async () => {
        throw error;
      }),
    ).rejects.toBe(error);
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
  aroundEach(async (runTest) => {
    vi.useFakeTimers();
    vi.mocked(reportCrash).mockClear();
    await runTest();
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

  test("retries Aborted for no-side-effect methods then succeeds", async () => {
    const next = vi
      .fn()
      .mockRejectedValueOnce(new ConnectError("socket disconnected", Code.Aborted))
      .mockResolvedValueOnce(okResponse);

    const res = await settle(
      retryInterceptor()(next)(makeUnaryReq(OperatorService.method.getWorkspace)),
    );

    expect(res).toBe(okResponse);
    expect(next).toHaveBeenCalledTimes(2);
  });

  test("does not retry Aborted for methods without an idempotency declaration", async () => {
    const next = vi
      .fn()
      .mockRejectedValueOnce(new ConnectError("operation aborted", Code.Aborted))
      .mockResolvedValueOnce(okResponse);

    await expect(
      settle(retryInterceptor()(next)(makeUnaryReq(OperatorService.method.updateTailorDBType))),
    ).rejects.toThrow("operation aborted");
    expect(next).toHaveBeenCalledOnce();
  });

  test("methods eligible for Aborted retries remain read-only", () => {
    type RetryMethodDescriptor = Pick<
      (typeof OperatorService.method)[keyof typeof OperatorService.method],
      "idempotency" | "name"
    >;
    const findNonReadOnlyMethods = (methods: readonly RetryMethodDescriptor[]) =>
      methods
        .filter(
          ({ idempotency }) =>
            idempotency === MethodOptions_IdempotencyLevel.NO_SIDE_EFFECTS ||
            idempotency === MethodOptions_IdempotencyLevel.IDEMPOTENT,
        )
        .filter(({ name }) => !/^(Download|Get|List)/.test(name))
        .map(({ name }) => name);

    const methods = Object.values(OperatorService.method);
    expect(
      methods.some(
        ({ idempotency }) =>
          idempotency === MethodOptions_IdempotencyLevel.NO_SIDE_EFFECTS ||
          idempotency === MethodOptions_IdempotencyLevel.IDEMPOTENT,
      ),
    ).toBe(true);
    expect(findNonReadOnlyMethods(methods)).toEqual([]);

    const mutatingSentinel = {
      ...OperatorService.method.getWorkspace,
      name: "UpdateFutureResource",
      idempotency: MethodOptions_IdempotencyLevel.IDEMPOTENT,
    };
    expect(findNonReadOnlyMethods([...methods, mutatingSentinel])).toEqual([
      "UpdateFutureResource",
    ]);
  });

  test("does not retry workspace creation when the outcome is ambiguous", async () => {
    const next = vi
      .fn()
      .mockRejectedValueOnce(new ConnectError("unavailable", Code.Unavailable))
      .mockResolvedValueOnce(okResponse);

    await expect(
      settle(retryInterceptor()(next)(makeUnaryReq(OperatorService.method.createWorkspace))),
    ).rejects.toThrow("unavailable");
    expect(next).toHaveBeenCalledOnce();
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
  aroundEach(async (runTest) => {
    await runTest();
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
  test.each([
    ["CreateWorkflow", "create", "Workflow"],
    ["CreateTailorDBService", "create", "TailorDBService"],
    ["CreateTailorDBType", "create", "TailorDBType"],
    ["UpdateWorkflow", "update", "Workflow"],
    ["UpdateTailorDBType", "update", "TailorDBType"],
    ["DeleteWorkflow", "delete", "Workflow"],
    ["DeleteExecutorExecutor", "delete", "ExecutorExecutor"],
    ["SetMetadata", "set", "Metadata"],
    ["ListWorkflows", "list", "Workflows"],
    ["ListWorkflowJobFunctions", "list", "WorkflowJobFunctions"],
    ["GetStaticWebsite", "get", "StaticWebsite"],
    ["UnknownMethod", "perform", "resource"],
    ["", "perform", "resource"],
  ])("parses %s as { operation: %s, resourceType: %s }", (methodName, operation, resourceType) => {
    expect(parseMethodName(methodName)).toEqual({ operation, resourceType });
  });
});

describe("errorHandlingInterceptor", () => {
  test("does not leak the request payload into the enhanced error message", async () => {
    const req = {
      stream: false,
      service: OperatorService,
      method: OperatorService.method.testExecScript,
      header: new Headers(),
      message: {
        workspaceId: "workspace-id",
        name: "query-gql.js",
        code: "export async function main() {}",
        arg: '{"endpoint":"https://app.example.com/query","accessToken":"tpmu_supersecrettoken","query":"mutation { m }"}',
      },
    } as unknown as UnaryRequest;
    const next = vi
      .fn()
      .mockRejectedValue(new ConnectError("context deadline exceeded", Code.DeadlineExceeded));

    const promise = errorHandlingInterceptor()(next)(req);

    await expect(promise).rejects.toThrow(ConnectError);
    const error = await promise.catch((e: unknown) => e as ConnectError);
    expect(error.message).toContain("context deadline exceeded");
    expect(error.message).not.toContain("tpmu_supersecrettoken");
    expect(error.message).not.toContain('"arg"');
  });

  test("includes allowlisted resource identifiers in the enhanced error message", async () => {
    const req = {
      stream: false,
      service: OperatorService,
      method: OperatorService.method.createTailorDBType,
      header: new Headers(),
      message: {
        workspaceId: "22222222-2222-2222-2222-222222222222",
        namespaceName: "shared-db",
        tailordbType: { name: "Order", description: "do-not-print-payload" },
      },
    } as unknown as UnaryRequest;
    const next = vi.fn().mockRejectedValue(new ConnectError("already exists", Code.AlreadyExists));

    const promise = errorHandlingInterceptor()(next)(req);

    await expect(promise).rejects.toThrow(ConnectError);
    const error = await promise.catch((e: unknown) => e as ConnectError);
    expect(error.message).toContain(
      "Failed to create TailorDBType (workspaceId: 22222222-2222-2222-2222-222222222222, namespaceName: shared-db, tailordbType.name: Order): already exists",
    );
    expect(error.message).not.toContain("do-not-print-payload");
  });

  test("surfaces id-like identifiers while keeping sensitive fields out", async () => {
    const req = {
      stream: false,
      service: OperatorService,
      method: OperatorService.method.resumeWorkflowExecution,
      header: new Headers(),
      message: {
        workspaceId: "22222222-2222-2222-2222-222222222222",
        executionId: "0189aaaa-bbbb-cccc-dddd-eeeeffff0000",
        trn: "trn:v1:workspace/staffing:tailordb/shared-db",
        email: "admin@example.com",
        secretmanagerSecretValue: "do-not-print-secret",
      },
    } as unknown as UnaryRequest;
    const next = vi.fn().mockRejectedValue(new ConnectError("not found", Code.NotFound));

    const promise = errorHandlingInterceptor()(next)(req);

    await expect(promise).rejects.toThrow(ConnectError);
    const error = await promise.catch((e: unknown) => e as ConnectError);
    expect(error.message).toContain("workspaceId: 22222222-2222-2222-2222-222222222222");
    expect(error.message).toContain("executionId: 0189aaaa-bbbb-cccc-dddd-eeeeffff0000");
    expect(error.message).toContain("trn: trn:v1:workspace/staffing:tailordb/shared-db");
    expect(error.message).not.toContain("admin@example.com");
    expect(error.message).not.toContain("do-not-print-secret");
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

describe("fetchMachineUserToken", () => {
  const fetchMock = vi.fn();
  const connectTimeoutError = () =>
    new TypeError("fetch failed", {
      cause: Object.assign(new Error("Connect Timeout Error"), {
        code: "UND_ERR_CONNECT_TIMEOUT",
      }),
    });

  aroundEach(async (runTest) => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    try {
      await runTest();
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  test("returns the parsed token on success", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ token_type: "Bearer", access_token: "token-1", expires_in: 3600 }),
    });

    const result = await fetchMachineUserToken("https://example.com", "client-id", "client-secret");

    expect(result).toEqual({ token_type: "Bearer", access_token: "token-1", expires_in: 3600 });
  });

  test("retries a connection timeout after 500ms", async () => {
    vi.useFakeTimers();
    using randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    fetchMock.mockRejectedValueOnce(connectTimeoutError()).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({ token_type: "Bearer", access_token: "token-1", expires_in: 3600 }),
    });

    const token = fetchMachineUserToken("https://example.com", "client-id", "client-secret");
    const result = token.then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(499);
    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(result).resolves.toEqual({
      ok: true,
      value: { token_type: "Bearer", access_token: "token-1", expires_in: 3600 },
    });

    expect(fetchMock.mock.calls[1]).toEqual(fetchMock.mock.calls[0]);
    expect(randomSpy).toHaveBeenCalledOnce();
  });

  test("stops after three connection timeouts and preserves the last error", async () => {
    vi.useFakeTimers();
    using randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const errors = [connectTimeoutError(), connectTimeoutError(), connectTimeoutError()];
    for (const error of errors) {
      fetchMock.mockRejectedValueOnce(error);
    }

    const token = fetchMachineUserToken("https://example.com", "client-id", "client-secret");
    const result = token.then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await expect(result).resolves.toEqual({ ok: false, error: errors[2] });
    expect(randomSpy).toHaveBeenCalledTimes(2);
  });

  test("does not retry other fetch failures", async () => {
    const socketError = new TypeError("fetch failed", {
      cause: Object.assign(new Error("Socket Error"), { code: "UND_ERR_SOCKET" }),
    });
    fetchMock.mockRejectedValue(socketError);

    await expect(
      fetchMachineUserToken("https://example.com", "client-id", "client-secret"),
    ).rejects.toBe(socketError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  test("includes status, statusText, and response body in the error on failure", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: () => Promise.resolve("access denied"),
    });

    await expect(
      fetchMachineUserToken("https://example.com", "client-id", "client-secret"),
    ).rejects.toThrow("Failed to fetch machine user token: 403 Forbidden access denied");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  test("falls back to an empty body when reading the response body fails", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: () => Promise.reject(new Error("stream already read")),
    });

    await expect(
      fetchMachineUserToken("https://example.com", "client-id", "client-secret"),
    ).rejects.toThrow("Failed to fetch machine user token: 500 Internal Server Error");
  });
});

describe("fetchPlatformMachineUserToken", () => {
  const fetchMock = vi.fn();
  const connectTimeoutError = () =>
    new TypeError("fetch failed", {
      cause: Object.assign(new Error("Connect Timeout Error"), {
        code: "UND_ERR_CONNECT_TIMEOUT",
      }),
    });
  const discoveryResponse = () => ({
    ok: true,
    status: 200,
    headers: new Headers({ "Content-Type": "application/json" }),
    json: () =>
      Promise.resolve({ token_endpoint: "https://api.tailor.tech/auth/platform/oauth2/token" }),
  });
  const tokenResponse = () => ({
    ok: true,
    status: 200,
    headers: new Headers({ "Content-Type": "application/json" }),
    json: () =>
      Promise.resolve({ token_type: "bearer", access_token: "token-1", expires_in: 3600 }),
  });

  aroundEach(async (runTest) => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    try {
      await runTest();
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });

  test("retries a connection timeout on the discovery request after 500ms", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    fetchMock
      .mockRejectedValueOnce(connectTimeoutError())
      .mockResolvedValueOnce(discoveryResponse())
      .mockResolvedValueOnce(tokenResponse());

    const result = fetchPlatformMachineUserToken("client-id", "client-secret").then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(499);
    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toMatchObject({
      ok: true,
      value: { accessToken: "token-1" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test("retries a connection timeout on the token request after 500ms", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    fetchMock
      .mockResolvedValueOnce(discoveryResponse())
      .mockRejectedValueOnce(connectTimeoutError())
      .mockResolvedValueOnce(discoveryResponse())
      .mockResolvedValueOnce(tokenResponse());

    const result = fetchPlatformMachineUserToken("client-id", "client-secret").then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(499);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toMatchObject({
      ok: true,
      value: { accessToken: "token-1" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  test("stops after three connection timeouts and preserves the last error", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const errors = [connectTimeoutError(), connectTimeoutError(), connectTimeoutError()];
    for (const error of errors) {
      fetchMock.mockRejectedValueOnce(error);
    }

    const result = fetchPlatformMachineUserToken("client-id", "client-secret").then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await expect(result).resolves.toEqual({ ok: false, error: errors[2] });
  });

  test("does not retry other fetch failures", async () => {
    const socketError = new TypeError("fetch failed", {
      cause: Object.assign(new Error("Socket Error"), { code: "UND_ERR_SOCKET" }),
    });
    fetchMock.mockRejectedValue(socketError);

    await expect(fetchPlatformMachineUserToken("client-id", "client-secret")).rejects.toBe(
      socketError,
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("closeConnectionPool", () => {
  const currentGeneration = Symbol.for("undici.globalDispatcher.2");
  const legacyGeneration = Symbol.for("undici.globalDispatcher.1");
  const globals = globalThis as Record<symbol, unknown>;
  const setDispatcher = (key: symbol, value: unknown) => {
    globals[key] = value;
  };

  aroundEach(async (runTest) => {
    const originals = [currentGeneration, legacyGeneration].map(
      (key) => [key, Object.hasOwn(globals, key), globals[key]] as const,
    );
    await runTest();
    for (const [key, existed, value] of originals) {
      if (existed) {
        globals[key] = value;
      } else {
        delete globals[key];
      }
    }
  });

  test("closes only the newest dispatcher generation", async () => {
    const closeCurrent = vi.fn().mockResolvedValue(undefined);
    const closeLegacy = vi.fn().mockResolvedValue(undefined);
    setDispatcher(currentGeneration, { close: closeCurrent });
    setDispatcher(legacyGeneration, { close: closeLegacy });

    await closeConnectionPool();

    expect(closeCurrent).toHaveBeenCalledTimes(1);
    expect(closeLegacy).not.toHaveBeenCalled();
  });

  test("falls back to the legacy dispatcher generation", async () => {
    const closeLegacy = vi.fn().mockResolvedValue(undefined);
    setDispatcher(currentGeneration, undefined);
    setDispatcher(legacyGeneration, { close: closeLegacy });

    await closeConnectionPool();

    expect(closeLegacy).toHaveBeenCalledTimes(1);
  });

  test("resolves when no dispatcher is installed", async () => {
    setDispatcher(currentGeneration, undefined);
    setDispatcher(legacyGeneration, undefined);

    await expect(closeConnectionPool()).resolves.toBeUndefined();
  });

  test("resolves when the dispatcher exposes a non-callable close", async () => {
    setDispatcher(currentGeneration, { close: "not a function" });
    setDispatcher(legacyGeneration, undefined);

    await expect(closeConnectionPool()).resolves.toBeUndefined();
  });
});
