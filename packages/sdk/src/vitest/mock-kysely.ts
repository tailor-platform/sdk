/**
 * Kysely-layer mock for unit testing.
 *
 * Builds a real Kysely instance backed by a mock driver: queries compile and
 * type-check normally, but execution returns staged rows and records every
 * query for assertions.
 */

import {
  ColumnNode,
  type CompiledQuery,
  type DatabaseConnection,
  type Dialect,
  type Driver,
  InsertQueryNode,
  Kysely,
  type OperationNode,
  type OperationNodeKind,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  PrimitiveValueListNode,
  type QueryResult,
  ReferenceNode,
  type Transaction,
  UpdateQueryNode,
  ValueListNode,
  ValueNode,
  ValuesNode,
} from "kysely";
import { assertDefined } from "@/utils/assert";

function unwrapValue(node: OperationNode): unknown {
  return ValueNode.is(node) ? node.value : node;
}

function insertRows(node: OperationNode): Record<string, unknown>[] {
  if (!InsertQueryNode.is(node)) {
    throw new Error(`insertRows: expected InsertQueryNode, got ${node.kind}`);
  }
  const columns = node.columns;
  const valuesNode = node.values;
  if (columns === undefined || valuesNode === undefined || !ValuesNode.is(valuesNode)) {
    throw new Error("insertRows: unsupported insert shape; inspect query.node instead");
  }
  return valuesNode.values.map((row) => {
    if (!PrimitiveValueListNode.is(row) && !ValueListNode.is(row)) {
      throw new Error("insertRows: unsupported insert shape; inspect query.node instead");
    }
    const values = PrimitiveValueListNode.is(row) ? row.values : row.values.map(unwrapValue);
    const result: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      result[col.column.name] = values[i];
    });
    return result;
  });
}

function insertValues(node: OperationNode): Record<string, unknown> {
  const rows = insertRows(node);
  if (rows.length !== 1) {
    throw new Error(
      `insertValues: query inserts ${rows.length} rows; use insertRows() for multi-row inserts`,
    );
  }
  return assertDefined(rows[0], "insertValues: first row missing");
}

function updateValues(node: OperationNode): Record<string, unknown> {
  if (!UpdateQueryNode.is(node)) {
    throw new Error(`updateValues: expected UpdateQueryNode, got ${node.kind}`);
  }
  if (node.updates === undefined) {
    throw new Error("updateValues: unsupported update shape; inspect query.node instead");
  }
  const result: Record<string, unknown> = {};
  for (const update of node.updates) {
    const col = update.column;
    const name = ColumnNode.is(col)
      ? col.column.name
      : ReferenceNode.is(col) && ColumnNode.is(col.column)
        ? col.column.column.name
        : undefined;
    if (name === undefined) {
      throw new Error("updateValues: unsupported update shape; inspect query.node instead");
    }
    result[name] = unwrapValue(update.value);
  }
  return result;
}

/** A single statement executed against the mock, captured in order. */
export interface ExecutedQuery {
  /** The Kysely operation node kind, e.g. `"SelectQueryNode"`. */
  kind: OperationNodeKind;
  /** The compiled SQL string. */
  sql: string;
  /** The bound parameter values, in positional order. */
  parameters: readonly unknown[];
  /** The compiled Kysely operation node. */
  node: OperationNode;
  /** One `{ column: value }` map per row written by an insert. */
  insertRows: () => Record<string, unknown>[];
  /** The `{ column: value }` map written by a single-row insert. */
  insertValues: () => Record<string, unknown>;
  /** The `{ column: value }` map written by an update's SET clause. */
  updateValues: () => Record<string, unknown>;
}

function toExecutedQuery(compiledQuery: CompiledQuery): ExecutedQuery {
  const node = compiledQuery.query;
  return {
    kind: node.kind,
    sql: compiledQuery.sql,
    parameters: compiledQuery.parameters,
    node,
    insertRows: () => insertRows(node),
    insertValues: () => insertValues(node),
    updateValues: () => updateValues(node),
  };
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

/** Controls and assertions for a {@link createKyselyMock} instance. */
export interface KyselyMock<DB> {
  /** The mock Kysely instance to run queries against. */
  db: Kysely<DB>;
  /** Every recorded query, in execution order. */
  executedQueries: ExecutedQuery[];
  /** Recorded SELECT queries. */
  selects: ExecutedQuery[];
  /** Recorded INSERT queries. */
  inserts: ExecutedQuery[];
  /** Recorded UPDATE queries. */
  updates: ExecutedQuery[];
  /** Recorded DELETE queries. */
  deletes: ExecutedQuery[];
  /** Stage the rows the next query returns. */
  enqueueResult: (result: MockResult) => void;
  /** Stage the rows for several upcoming queries, consumed in order. */
  enqueueResults: (...results: MockResult[]) => void;
  /** Set a resolver that returns rows by inspecting each query. */
  setQueryResolver: (resolver: QueryResolver) => void;
  /** Run `fn` inside a real transaction and return its result. */
  withTx: <R>(fn: (trx: Transaction<DB>) => Promise<R>) => Promise<R>;
  /** Clear recorded queries and staged results. */
  reset: () => void;
  /** Same as {@link KyselyMock.reset}; enables `using` disposal. */
  [Symbol.dispose]: () => void;
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
    const query = toExecutedQuery(compiledQuery);
    this.state.executed.push(query);
    const { rows, numAffectedRows } = this.state.next(query);
    return {
      rows: rows as R[],
      numAffectedRows: numAffectedRows ?? BigInt(rows.length),
    };
  }

  streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error("createKyselyMock: streaming is not supported");
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
 * `createKyselyMock<Namespace["main-db"]>()`.
 * @returns A {@link KyselyMock} with the mock `db`, recorded queries, and result staging.
 */
export function createKyselyMock<DB = Record<string, never>>(): KyselyMock<DB> {
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
    withTx: (fn) => kysely.transaction().execute(fn),
    reset: () => state.reset(),
    [Symbol.dispose]: () => state.reset(),
  };
}
