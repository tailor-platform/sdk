/**
 * Mock utilities for challenge problem tests.
 * Based on example/tests/apply_command.test.ts patterns.
 */

type MainFunction = (args: Record<string, unknown>) => unknown | Promise<unknown>;
type QueryResolver = (query: string, params: unknown[]) => unknown[];

type GlobalThisExtended = typeof globalThis & {
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
  };
};

const GlobalThis = globalThis as GlobalThisExtended;

export type TailordbMockResult = {
  executedQueries: { query: string; params: unknown[] }[];
  createdClients: { namespace?: string; ended: boolean }[];
};

export function setupTailordbMock(resolver: QueryResolver = () => []): TailordbMockResult {
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
      const rows = resolver(query, params) ?? [];
      return { rows: Array.isArray(rows) ? rows : [] };
    }
  }

  GlobalThis.tailordb = {
    Client: MockTailordbClient,
  } as typeof GlobalThis.tailordb;

  return { executedQueries, createdClients };
}

export type WorkflowMockResult = {
  triggeredJobs: { jobName: string; args: unknown }[];
};

type JobHandler = (jobName: string, args: unknown) => unknown;

export function setupWorkflowMock(handler: JobHandler): WorkflowMockResult {
  const triggeredJobs: { jobName: string; args: unknown }[] = [];

  GlobalThis.tailor = {
    workflow: {
      triggerJobFunction: (jobName: string, args: unknown) => {
        triggeredJobs.push({ jobName, args });
        return handler(jobName, args);
      },
    },
  } as typeof GlobalThis.tailor;

  return { triggeredJobs };
}

export function cleanupMocks(): void {
  delete GlobalThis.tailordb;
  // tailor is declared as a required namespace by @tailor-platform/function-types
  delete (GlobalThis as { tailor?: typeof GlobalThis.tailor }).tailor;
}

export type { MainFunction, QueryResolver };
