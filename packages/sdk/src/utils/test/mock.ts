import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type { TailorInvoker } from "@/types/user";

type MainFunction = (args: Record<string, unknown>) => unknown | Promise<unknown>;
type QueryResolver = (query: string, params: unknown[]) => unknown[];
type JobHandler = (jobName: string, args: unknown) => unknown;

/**
 * Raw invoker shape as returned by the platform's `tailor.context.getInvoker()` op.
 * Bundled wrappers convert this into the SDK-facing `TailorInvoker` shape at call time.
 */
interface RawInvoker {
  id: string;
  type: "user" | "machine_user";
  workspaceId: string;
  attributes: string[];
  attributeMap: Record<string, unknown>;
}

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
    };
    context?: {
      getInvoker: () => RawInvoker | null;
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
 * resolver/executor/workflow tests. Accepts the SDK-facing `TailorInvoker`
 * shape and converts it to the raw shape the platform op would return, so
 * bundled wrappers can apply their usual SDK-shape normalization.
 * @param invoker - The `TailorInvoker` value to return from `getInvoker()`, or `null` for anonymous.
 */
export function setupInvokerMock(invoker: TailorInvoker): void {
  const raw: RawInvoker | null = invoker
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
 * Creates a function that imports a bundled JS file and returns its `main` export.
 * Used to test bundled output from `apply --buildOnly`.
 * @param baseDir - Base directory where bundled files are located.
 * @returns An async function that takes a relative path and returns the `main` function.
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
