import { vi } from "vitest";
import { tailordbRoot, withDispose } from "./shared";

type QueryResolver = (query: string, params: unknown[]) => unknown[];

interface ExecutedQuery {
  query: string;
  params: unknown[];
}

interface CreatedClient {
  namespace: string | undefined;
  ended: boolean;
}

class MockQueryResult {
  command: string;
  rowCount: number;
  rows: unknown[];

  constructor(rows: unknown[]) {
    this.command = "";
    this.rowCount = rows.length;
    this.rows = rows;
  }
}

// ---------------------------------------------------------------------------
// TailorDB Mock
// ---------------------------------------------------------------------------

/**
 * Acquire a disposable mock for TailorDB operations. Installs a mock
 * `tailordb.Client` whose `queryObject` is a shared `vi.fn()` (so query
 * responses can be staged before the client is constructed). Restored on
 * dispose.
 * @returns Disposable TailorDB mock control object
 * @example
 * ```typescript
 * import { mockTailordb } from "@tailor-platform/sdk/vitest";
 *
 * test("order-based", async () => {
 *   using db = mockTailordb();
 *   db.enqueueResults([], [{ age: 30 }], []); // BEGIN / SELECT / COMMIT
 *   // …
 *   expect(db.queryObject).toHaveBeenCalledTimes(3);
 *   expect(db.Client).toHaveBeenCalledWith({ namespace: "tailordb" });
 * });
 * ```
 */
export function mockTailordb() {
  const root = tailordbRoot();
  const prevClient = root.Client;

  const queryObject = vi.fn(
    async (_query: string, _params: unknown[] = []): Promise<MockQueryResult> =>
      new MockQueryResult([]),
  );
  const connect = vi.fn(async (): Promise<void> => {});
  const createdClients: CreatedClient[] = [];

  const Client = vi.fn(function (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this: any,
    config?: { namespace?: string },
  ) {
    const record: CreatedClient = { namespace: config?.namespace, ended: false };
    createdClients.push(record);
    this.connect = connect;
    this.end = vi.fn(async (): Promise<void> => {
      record.ended = true;
    });
    this.queryObject = queryObject;
    this.createTransaction = (name: string) => {
      if (!name) {
        throw new Error("Transaction name must be a non-empty string");
      }
      return {
        begin: async (): Promise<void> => {},
        commit: async (): Promise<void> => {},
        rollback: async (): Promise<void> => {},
        queryObject,
      };
    };
  });

  root.Client = Client;

  const facade = {
    /** The mock `tailordb.Client` constructor (`vi.fn`). */
    Client,
    /** The shared `queryObject` `vi.fn` used by every client and transaction. */
    queryObject,

    /**
     * Set a fallback query resolver. Called when the enqueue queue is empty.
     * @param resolver - Function that returns rows for a given query and params
     */
    setQueryResolver(resolver: QueryResolver): void {
      queryObject.mockImplementation(
        async (query: string, params: unknown[] = []) =>
          // user resolvers may return undefined
          // oxlint-disable-next-line typescript/no-unnecessary-condition
          new MockQueryResult(resolver(query, params) ?? []),
      );
    },

    /**
     * Enqueue rows for the next `queryObject` call (FIFO; takes priority over
     * `setQueryResolver`). Call with no arguments for an empty result.
     * @param rows - Row objects to return from the next `queryObject` call
     */
    enqueueResult(...rows: unknown[]): void {
      queryObject.mockImplementationOnce(async () => new MockQueryResult(rows));
    },

    /**
     * Enqueue rows for multiple subsequent `queryObject` calls (FIFO).
     * @param rowsList - Rows arrays, one per upcoming query
     */
    enqueueResults(...rowsList: unknown[][]): void {
      for (const rows of rowsList) {
        queryObject.mockImplementationOnce(async () => new MockQueryResult(rows));
      }
    },

    /**
     * All queries executed via `queryObject`, in order, derived from the vi.fn
     * call records.
     * @returns Executed queries array
     */
    get executedQueries(): ExecutedQuery[] {
      return queryObject.mock.calls.map(([query, params]) => ({
        query: query as string,
        // vitest records an omitted argument as undefined
        // oxlint-disable-next-line typescript/no-unnecessary-condition
        params: (params as unknown[]) ?? [],
      }));
    },

    /**
     * All TailorDB clients created, with their namespace and end state.
     * @returns Created clients array
     */
    get createdClients(): CreatedClient[] {
      return createdClients;
    },

    /** Reset query responses and recorded calls (keeps the mock installed). */
    reset(): void {
      queryObject.mockReset();
      queryObject.mockImplementation(async () => new MockQueryResult([]));
      connect.mockClear();
      Client.mockClear();
      createdClients.length = 0;
    },
  };

  return withDispose(facade, () => {
    root.Client = prevClient;
  });
}
