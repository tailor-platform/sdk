import * as path from "node:path";
import { pathToFileURL } from "node:url";

type MainFunction = (args: Record<string, unknown>) => unknown | Promise<unknown>;
type QueryResolver = (query: string, params: unknown[]) => unknown[];
type JobHandler = (jobName: string, args: unknown) => unknown;

type Invoker = {
  id: string;
  type: "user" | "machine_user";
  workspaceId: string;
  attributes: Record<string, unknown>;
  attributeList: string[];
} | null;

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
    context: {
      getInvoker: () => tailor.context.Invoker | null;
    };
  };
}

const GlobalThis = globalThis as TailordbGlobal;

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

export function setupWorkflowMock(handler: JobHandler): {
  triggeredJobs: { jobName: string; args: unknown }[];
} {
  const triggeredJobs: { jobName: string; args: unknown }[] = [];

  GlobalThis.tailor = {
    ...GlobalThis.tailor,
    workflow: {
      ...GlobalThis.tailor?.workflow,
      triggerJobFunction: (jobName: string, args: unknown) => {
        triggeredJobs.push({ jobName, args });
        return handler(jobName, args);
      },
    },
  } as typeof GlobalThis.tailor;

  return { triggeredJobs };
}

export function setupInvokerMock(invoker: Invoker): void {
  const raw: tailor.context.Invoker | null = invoker
    ? {
        id: invoker.id,
        type: invoker.type,
        workspaceId: invoker.workspaceId,
        attributes: invoker.attributeList,
        attributeMap: invoker.attributes,
      }
    : null;

  GlobalThis.tailor = {
    ...GlobalThis.tailor,
    context: {
      getInvoker: () => raw,
    },
  } as typeof GlobalThis.tailor;
}

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
