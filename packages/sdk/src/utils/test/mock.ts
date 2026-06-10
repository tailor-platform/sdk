import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type { ContextInvoker } from "@/runtime/context";
import type { TailorInvoker } from "@/types/user";

type MainFunction = (args: Record<string, unknown>) => unknown | Promise<unknown>;
type QueryResolver = (query: string, params: unknown[]) => unknown[];
type JobHandler = (jobName: string, args: unknown) => unknown;
type WaitHandler = (key: string, payload: unknown) => unknown;
type ResolveHandler = (
  executionId: string,
  key: string,
  callback: (payload: unknown) => unknown,
) => Promise<void> | void;

interface TailordbGlobal {
  tailordb?: {
    Client: new (config: { namespace?: string }) => {
      connect(): Promise<void> | void;
      end(): Promise<void> | void;
      queryObject(
        query: string,
        params?: unknown[],
      ): Promise<{ rows: unknown[] }> | { rows: unknown[] };
    };
  };
  tailor?: {
    workflow: {
      triggerJobFunction: (jobName: string, args: unknown) => unknown;
      wait?: (key: string, payload?: unknown) => unknown;
      resolve?: (
        executionId: string,
        key: string,
        callback: (payload: unknown) => unknown,
      ) => Promise<void>;
    };
    context: {
      getInvoker: () => ContextInvoker | null;
    };
  };
}

interface TailorErrorItem {
  message: string;
  path: (string | number)[];
}

interface TailorErrorsGlobal {
  TailorErrors?: new (errors: TailorErrorItem[]) => Error;
}

const GlobalThis = globalThis as TailordbGlobal & TailorErrorsGlobal;

/**
 * Sets up a mock for `globalThis.tailordb.Client` used in bundled resolver/executor tests.
 * @deprecated Use `mockTailordb` from `@tailor-platform/sdk/vitest` with the `tailor-runtime` environment instead.
 * @param resolver - Optional function to resolve query results. Defaults to returning empty arrays.
 * @returns Object containing arrays of executed queries and created clients for assertions.
 */
export function setupTailordbMock(resolver: QueryResolver = () => []): {
  executedQueries: { query: string; params: unknown[] }[];
  createdClients: { namespace?: string; ended: boolean }[];
} {
  const executedQueries: { query: string; params: unknown[] }[] = [];
  const createdClients: { namespace?: string; ended: boolean }[] = [];

  class MockTailordbClient {
    private record: { namespace?: string; ended: boolean };

    constructor({ namespace }: { namespace?: string }) {
      this.record = { namespace, ended: false };
      createdClients.push(this.record);
    }

    async connect(): Promise<void> {
      /* noop */
    }

    async end(): Promise<void> {
      this.record.ended = true;
    }

    async queryObject(query: string, params: unknown[] = []): Promise<{ rows: unknown[] }> {
      executedQueries.push({ query, params });
      return { rows: resolver(query, params) ?? [] };
    }
  }

  GlobalThis.tailordb = {
    Client: MockTailordbClient,
  } as typeof GlobalThis.tailordb;

  return { executedQueries, createdClients };
}

/**
 * Sets up a mock for `globalThis.tailor.workflow.triggerJobFunction` used in bundled workflow tests.
 * `wait`/`resolve` are stubbed to throw a helpful error directing to `mockWorkflow`,
 * so mistakenly calling wait without wait-point mocks produces a clear message instead of a TypeError.
 * @deprecated Use `mockWorkflow` from `@tailor-platform/sdk/vitest` with the `tailor-runtime` environment instead.
 * @param handler - Function that handles triggered job calls and returns results.
 * @returns Object containing an array of triggered jobs for assertions.
 */
export function setupWorkflowMock(handler: JobHandler): {
  triggeredJobs: { jobName: string; args: unknown }[];
} {
  const triggeredJobs: { jobName: string; args: unknown }[] = [];

  GlobalThis.tailor = {
    ...GlobalThis.tailor,
    workflow: {
      wait: () => {
        throw new Error(
          "tailor.workflow.wait is not mocked. Use mockWorkflow from @tailor-platform/sdk/vitest in tests.",
        );
      },
      resolve: async () => {
        throw new Error(
          "tailor.workflow.resolve is not mocked. Use mockWorkflow from @tailor-platform/sdk/vitest in tests.",
        );
      },
      ...GlobalThis.tailor?.workflow,
      triggerJobFunction: (jobName: string, args: unknown) => {
        triggeredJobs.push({ jobName, args });
        return handler(jobName, args);
      },
    },
  } as typeof GlobalThis.tailor;

  return { triggeredJobs };
}

/**
 * Sets up a mock for `globalThis.tailor.context.getInvoker` used in bundled
 * resolver/executor/workflow tests.
 * @deprecated With the `tailor-runtime` environment from `@tailor-platform/sdk/vitest`, drive the invoker via `vi.spyOn(globalThis.tailor.context, "getInvoker").mockReturnValue(...)` for bundled tests, or pass `invoker` directly to `.body()` when unit-testing resolvers/executors/workflow jobs against the TypeScript source.
 * @param invoker - The `TailorInvoker` value to return, or `null` for anonymous.
 */
export function setupInvokerMock(invoker: TailorInvoker): void {
  const raw: ContextInvoker | null = invoker
    ? {
        id: invoker.id,
        type: invoker.type,
        workspaceId: invoker.workspaceId,
        attributes: invoker.attributeList as string[],
        attributeMap: invoker.attributes as Record<string, unknown>,
      }
    : null;

  GlobalThis.tailor = {
    ...GlobalThis.tailor,
    context: {
      getInvoker: () => raw,
    },
  } as typeof GlobalThis.tailor;
}

/**
 * Sets up a mock for `globalThis.TailorErrors` used in bundled resolver tests.
 * Mimics the PF runtime's TailorErrors class that serializes errors with the `TailorErrors: ` prefix.
 * @deprecated Use the `tailor-runtime` environment from `@tailor-platform/sdk/vitest` which auto-injects TailorErrors.
 */
export function setupTailorErrorsMock(): void {
  GlobalThis.TailorErrors = class TailorErrors extends Error {
    errors: TailorErrorItem[];

    constructor(errors: TailorErrorItem[]) {
      super(`TailorErrors: ${JSON.stringify({ errors })}`);
      this.name = "TailorErrors";
      this.errors = errors;
    }
  };
}

/**
 * Sets up mocks for `globalThis.tailor.workflow.wait` and `.resolve` used in bundled workflow tests.
 * `triggerJobFunction` is stubbed to throw a helpful error directing to `setupWorkflowMock()`,
 * so mistakenly triggering a job without job mocks produces a clear message instead of silently returning undefined.
 * @deprecated Use `mockWorkflow` from `@tailor-platform/sdk/vitest` with the `tailor-runtime` environment instead.
 *   `setWaitHandler` / `setResolveHandler` cover wait/resolve, and `waitCalls` / `resolveCalls` give the same assertion shape.
 * @param config - Optional handlers for wait and resolve calls.
 * @param config.onWait - Handler called when wait is invoked.
 * @param config.onResolve - Handler called when resolve is invoked.
 * @returns Object containing arrays of wait and resolve calls for assertions.
 */
export function setupWaitPointMock(config?: { onWait?: WaitHandler; onResolve?: ResolveHandler }): {
  waitCalls: { key: string; payload: unknown }[];
  resolveCalls: { executionId: string; key: string }[];
} {
  const waitCalls: { key: string; payload: unknown }[] = [];
  const resolveCalls: { executionId: string; key: string }[] = [];

  GlobalThis.tailor = {
    ...GlobalThis.tailor,
    workflow: {
      triggerJobFunction: () => {
        throw new Error(
          "tailor.workflow.triggerJobFunction is not mocked. Use setupWorkflowMock() in tests.",
        );
      },
      ...GlobalThis.tailor?.workflow,
      wait: (key: string, payload?: unknown) => {
        waitCalls.push({ key, payload });
        return config?.onWait?.(key, payload);
      },
      resolve: async (
        executionId: string,
        key: string,
        callback: (payload: unknown) => unknown,
      ) => {
        resolveCalls.push({ executionId, key });
        await config?.onResolve?.(executionId, key, callback);
      },
    },
  } as typeof GlobalThis.tailor;

  return { waitCalls, resolveCalls };
}

/**
 * Creates a function that imports a bundled JS file and returns its `main` export.
 * Used to test bundled output from `apply --buildOnly`.
 * @param baseDir - Base directory where bundled files are located.
 * @returns An async function that takes a relative path and returns the `main` function.
 * @deprecated This is an SDK-internal testing helper. Bundling integrity is the SDK's responsibility,
 * not the application's — verify your code through unit tests against the TypeScript source and
 * E2E tests against a deployed application instead. This export will be removed in a future release.
 */
export function createImportMain(baseDir: string): (relativePath: string) => Promise<MainFunction> {
  return async (relativePath: string): Promise<MainFunction> => {
    const fileUrl = pathToFileURL(path.join(baseDir, relativePath));
    fileUrl.searchParams.set("v", `${Date.now()}-${Math.random()}`);
    const module = await import(fileUrl.href);
    const main = module.main;
    if (typeof main !== "function") {
      throw new Error(`Expected "main" to be a function in ${relativePath}, got ${typeof main}`);
    }
    return main;
  };
}
