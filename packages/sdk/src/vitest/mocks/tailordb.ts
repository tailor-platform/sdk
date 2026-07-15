import { isEqual } from "es-toolkit";
import { vi } from "vitest";
import { tailordbRoot, withDispose } from "./shared";

type QueryResolver = (query: string, params: unknown[]) => unknown[] | undefined;

/** Controls how unmatched TailorDB queries are handled. */
export interface MockTailordbOptions {
  /** Return an empty result or throw when no configured query behavior matches. */
  onUnhandled?: "fallback" | "error";
}

/** Matches a TailorDB query by SQL text and optionally by parameters. */
export interface QueryMatch {
  /** Exact SQL text or regular expression to match. */
  sql: string | RegExp;
  /** Exact parameters or a predicate for parameter matching. */
  params?: readonly unknown[] | ((params: unknown[]) => boolean);
}

/** Selects TailorDB queries that receive a configured response. */
export type QueryMatcher =
  | string
  | RegExp
  | QueryMatch
  | ((query: string, params: unknown[]) => boolean);

/** Configures persistent and one-time responses for matched queries. */
export interface QueryBehavior<Row> {
  /** Return these rows for every matching query after one-time responses are consumed. */
  returnsRows(rows: Row[]): QueryBehavior<Row>;
  /** Return these rows for the next matching query. */
  returnsRowsOnce(rows: Row[]): QueryBehavior<Row>;
  /** Reject every matching query after one-time responses are consumed. */
  rejects(error: unknown): QueryBehavior<Row>;
  /** Reject the next matching query. */
  rejectsOnce(error: unknown): QueryBehavior<Row>;
}

interface ExecutedQuery {
  query: string;
  params: unknown[];
}

interface CreatedClient {
  namespace: string | undefined;
  ended: boolean;
}

type QueryResponse = { type: "rows"; rows: unknown[] } | { type: "error"; error: unknown };

interface QueryRule {
  matcher: QueryMatcher;
  once: QueryResponse[];
  fallback?: QueryResponse;
}

function testRegex(regex: RegExp, value: string): boolean {
  const lastIndex = regex.lastIndex;
  regex.lastIndex = 0;
  try {
    return regex.test(value);
  } finally {
    regex.lastIndex = lastIndex;
  }
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
 * @param options - Query fallback behavior
 * @returns Disposable TailorDB mock control object
 * @example
 * ```typescript
 * import { mockTailordb } from "@tailor-platform/sdk/vitest";
 *
 * test("query-based", async () => {
 *   using db = mockTailordb();
 *   db.onQuery({ sql: /FROM users/, params: ["u-1"] }).returnsRows([{ age: 30 }]);
 *   // …
 *   expect(db.queryObject).toHaveBeenCalled();
 *   expect(db.Client).toHaveBeenCalledWith({ namespace: "tailordb" });
 * });
 * ```
 */
export function mockTailordb(options: MockTailordbOptions = {}) {
  const root = tailordbRoot();
  const prevClient = root.Client;

  const rules: QueryRule[] = [];
  let queryResolver: QueryResolver | undefined;

  function matchesQuery(matcher: QueryMatcher, query: string, params: unknown[]): boolean {
    if (typeof matcher === "function") return matcher(query, params);
    if (typeof matcher === "string") return query === matcher;
    if (matcher instanceof RegExp) return testRegex(matcher, query);

    let sqlMatches: boolean;
    if (typeof matcher.sql === "string") {
      sqlMatches = query === matcher.sql;
    } else {
      sqlMatches = testRegex(matcher.sql, query);
    }
    if (!sqlMatches || matcher.params === undefined) return sqlMatches;
    if (typeof matcher.params === "function") return matcher.params(params);
    const expectedParams = matcher.params;
    return (
      params.length === expectedParams.length &&
      params.every((value, index) => isEqual(value, expectedParams[index]))
    );
  }

  function queryResponse(response: QueryResponse): MockQueryResult {
    if (response.type === "error") throw response.error;
    return new MockQueryResult(response.rows);
  }

  async function defaultQuery(query: string, params: unknown[] = []): Promise<MockQueryResult> {
    for (let i = rules.length - 1; i >= 0; i -= 1) {
      const rule = rules[i];
      if (!rule || !matchesQuery(rule.matcher, query, params)) continue;
      const once = rule.once.shift();
      if (once) return queryResponse(once);
      if (rule.fallback) return queryResponse(rule.fallback);
    }

    if (queryResolver) return new MockQueryResult(queryResolver(query, params) ?? []);
    if (options.onUnhandled === "error") {
      throw new Error(`No TailorDB query behavior matched: ${query}`);
    }
    return new MockQueryResult([]);
  }

  const queryObject = vi.fn(defaultQuery);
  const defaultConnect = async (): Promise<void> => {};
  const connect = vi.fn(defaultConnect);
  const createdClients: CreatedClient[] = [];

  function enqueueRowsList(rowsList: unknown[][]): void {
    for (const rows of rowsList) {
      queryObject.mockImplementationOnce(async () => new MockQueryResult(rows));
    }
  }

  const defaultClient = function (
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
  };
  const Client = vi.fn(defaultClient);

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
      queryResolver = resolver;
      queryObject.mockImplementation(defaultQuery);
    },

    /**
     * Configure responses for queries matching SQL text, parameters, or a predicate.
     * More recently registered matchers take precedence.
     * Do not combine matchers with a direct `queryObject.mockImplementation()` override.
     * @param matcher - Query matcher
     * @returns Chainable query behavior
     */
    onQuery<Row = unknown>(matcher: QueryMatcher): QueryBehavior<Row> {
      const rule: QueryRule = { matcher, once: [] };
      rules.push(rule);
      const behavior: QueryBehavior<Row> = {
        returnsRows(rows) {
          rule.fallback = { type: "rows", rows };
          return behavior;
        },
        returnsRowsOnce(rows) {
          rule.once.push({ type: "rows", rows });
          return behavior;
        },
        rejects(error) {
          rule.fallback = { type: "error", error };
          return behavior;
        },
        rejectsOnce(error) {
          rule.once.push({ type: "error", error });
          return behavior;
        },
      };
      return behavior;
    },

    /**
     * Enqueue rows for the next `queryObject` call (FIFO; takes priority over
     * `setQueryResolver`). Call with no arguments for an empty result.
     * @param rows - Row objects to return from the next `queryObject` call
     */
    enqueueResult(...rows: unknown[]): void {
      enqueueRowsList([rows]);
    },

    /**
     * Enqueue rows for multiple subsequent `queryObject` calls (FIFO).
     * @param rowsList - Rows arrays, one per upcoming query
     */
    enqueueResults(...rowsList: unknown[][]): void {
      enqueueRowsList(rowsList);
    },

    /**
     * Enqueue row arrays for subsequent queries whose exact order is under test.
     * @param rowsList - Rows arrays, one per upcoming query
     */
    enqueueRows(...rowsList: unknown[][]): void {
      enqueueRowsList(rowsList);
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

    /** Clear recorded calls while preserving configured query behavior. */
    clear(): void {
      queryObject.mockClear();
      connect.mockClear();
      Client.mockClear();
      createdClients.length = 0;
    },

    /** Reset query responses and recorded calls (keeps the mock installed). */
    reset(): void {
      queryObject.mockReset();
      queryObject.mockImplementation(defaultQuery);
      connect.mockReset();
      connect.mockImplementation(defaultConnect);
      Client.mockReset();
      Client.mockImplementation(defaultClient);
      createdClients.length = 0;
      rules.length = 0;
      queryResolver = undefined;
    },
  };

  return withDispose(facade, () => {
    root.Client = prevClient;
  });
}
