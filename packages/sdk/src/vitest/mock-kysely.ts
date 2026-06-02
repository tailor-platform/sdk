/**
 * Kysely-layer mock for unit testing.
 *
 * Builds a real Kysely instance backed by a mock driver: queries compile and
 * type-check normally, but execution returns staged rows and records every
 * query for assertions.
 */

import {
  type CompiledQuery,
  type DatabaseConnection,
  type Dialect,
  type Driver,
  Kysely,
  type OperationNodeKind,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type QueryResult,
} from "kysely";

/** A single statement executed against the mock, captured in order. */
export interface ExecutedQuery {
  kind: OperationNodeKind;
  sql: string;
  parameters: readonly unknown[];
}

type MockRow = Record<string, unknown>;
type MockResult = MockRow[] | { rows?: MockRow[]; numAffectedRows?: number | bigint };
type QueryResolver = (query: ExecutedQuery) => MockResult | undefined;

interface StagedResult {
  rows: MockRow[];
  numAffectedRows: bigint | undefined;
}

function toStagedResult(result: MockResult): StagedResult {
  if (Array.isArray(result)) return { rows: result, numAffectedRows: undefined };
  return {
    rows: result.rows ?? [],
    numAffectedRows:
      result.numAffectedRows === undefined ? undefined : BigInt(result.numAffectedRows),
  };
}

/** Controls and assertions for a {@link createMockKysely} instance. */
export interface MockKysely<DB> {
  db: Kysely<DB>;
  executedQueries: ExecutedQuery[];
  selects: ExecutedQuery[];
  inserts: ExecutedQuery[];
  updates: ExecutedQuery[];
  deletes: ExecutedQuery[];
  enqueueResult: (result: MockResult) => void;
  enqueueResults: (...results: MockResult[]) => void;
  setQueryResolver: (resolver: QueryResolver) => void;
  reset: () => void;
}

class MockState {
  readonly executed: ExecutedQuery[] = [];
  private readonly queue: MockResult[] = [];
  private resolver: QueryResolver | undefined;

  enqueue(...results: MockResult[]): void {
    this.queue.push(...results);
  }

  setResolver(resolver: QueryResolver): void {
    this.resolver = resolver;
  }

  next(query: ExecutedQuery): StagedResult {
    const resolved = this.resolver?.(query);
    if (resolved !== undefined) return toStagedResult(resolved);
    const queued = this.queue.shift();
    return queued === undefined ? { rows: [], numAffectedRows: undefined } : toStagedResult(queued);
  }

  reset(): void {
    this.executed.length = 0;
    this.queue.length = 0;
    this.resolver = undefined;
  }
}

class MockConnection implements DatabaseConnection {
  constructor(private readonly state: MockState) {}

  async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    const query: ExecutedQuery = {
      kind: compiledQuery.query.kind,
      sql: compiledQuery.sql,
      parameters: compiledQuery.parameters,
    };
    this.state.executed.push(query);
    const { rows, numAffectedRows } = this.state.next(query);
    return {
      rows: rows as R[],
      numAffectedRows: numAffectedRows ?? BigInt(rows.length),
    };
  }

  streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error("createMockKysely: streaming is not supported");
  }
}

class MockDriver implements Driver {
  constructor(private readonly state: MockState) {}

  async init(): Promise<void> {}

  async acquireConnection(): Promise<DatabaseConnection> {
    return new MockConnection(this.state);
  }

  // No-ops so begin/commit/rollback never enter `executed` and pollute counts.
  async beginTransaction(): Promise<void> {}
  async commitTransaction(): Promise<void> {}
  async rollbackTransaction(): Promise<void> {}

  async releaseConnection(): Promise<void> {}
  async destroy(): Promise<void> {}
}

function byKind(state: MockState, kind: OperationNodeKind): ExecutedQuery[] {
  return state.executed.filter((query) => query.kind === kind);
}

/**
 * Create a mock Kysely instance for unit-testing code that runs Kysely queries.
 * Pass the namespace schema as the type argument, e.g.
 * `createMockKysely<Namespace["main-db"]>()`.
 * @returns A {@link MockKysely} with the mock `db`, recorded queries, and result staging.
 */
export function createMockKysely<DB = Record<string, never>>(): MockKysely<DB> {
  const state = new MockState();
  const dialect: Dialect = {
    createDriver: () => new MockDriver(state),
    createQueryCompiler: () => new PostgresQueryCompiler(),
    createAdapter: () => new PostgresAdapter(),
    createIntrospector: (db) => new PostgresIntrospector(db),
  };
  const kysely = new Kysely<DB>({ dialect });

  return {
    db: kysely,
    get executedQueries() {
      return state.executed;
    },
    get selects() {
      return byKind(state, "SelectQueryNode");
    },
    get inserts() {
      return byKind(state, "InsertQueryNode");
    },
    get updates() {
      return byKind(state, "UpdateQueryNode");
    },
    get deletes() {
      return byKind(state, "DeleteQueryNode");
    },
    enqueueResult: (result) => state.enqueue(result),
    enqueueResults: (...results) => state.enqueue(...results),
    setQueryResolver: (resolver) => state.setResolver(resolver),
    reset: () => state.reset(),
  };
}
