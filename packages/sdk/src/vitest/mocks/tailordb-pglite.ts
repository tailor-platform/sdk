import { vi } from "vitest";
import { tailordbRoot, withDispose } from "./shared";
import type { PGliteClient, PGliteQueryResult } from "../pglite-kysely";

/** A query executed through the PGlite-backed TailorDB client. */
export interface ExecutedPGliteQuery {
  /** Namespace of the `getDB` call that issued the query. */
  namespace: string;
  /** SQL text with positional (`$1`, `$2`, ...) placeholders. */
  query: string;
  /** Parameter values bound to the placeholders. */
  params: unknown[];
}

/** Options for {@link mockTailordbWithPGlite}. */
export interface MockTailordbPGliteOptions {
  /**
   * PGlite instance per `getDB` namespace. A `getDB` call for a namespace
   * missing here throws instead of falling back to another instance. Pass the
   * same instance under several namespaces to share one database between them.
   */
  namespaces: Record<string, PGliteClient>;
}

interface CreatedClient {
  namespace: string;
  ended: boolean;
}

// One transaction at a time per PGlite instance: PGlite is a single Postgres
// session, so statements from another getDB instance would otherwise run
// inside an open transaction.
class TransactionLock {
  #holder: unknown = null;
  #waiters: Array<() => void> = [];

  holds(owner: unknown): boolean {
    return this.#holder === owner;
  }

  async acquire(owner: unknown): Promise<void> {
    while (this.#holder !== null) {
      await new Promise<void>((resolve) => this.#waiters.push(resolve));
    }
    this.#holder = owner;
  }

  release(owner: unknown): void {
    if (this.#holder !== owner) return;
    this.#holder = null;
    this.#waiters.shift()?.();
  }
}

const BEGIN_PATTERN = /^\s*(?:begin|start\s+transaction)\b/i;
// `rollback to savepoint` stays inside the transaction, so it must not
// release the lock.
const END_PATTERN = /^\s*(?:commit\b|rollback\b(?!(?:\s+(?:work|transaction))?\s+to\b))/i;

function toQueryObjectResult(result: PGliteQueryResult) {
  return {
    // The client contract only checks whether the command is a DML verb, so
    // any of the three works when an older PGlite omits the tag.
    command: result.command ?? (result.affectedRows ? "UPDATE" : "SELECT"),
    rowCount: result.rowCount ?? result.affectedRows ?? result.rows.length,
    rows: result.rows,
  };
}

/**
 * Acquire a disposable mock that backs `tailordb.Client` with PGlite, so
 * resolver/executor/workflow code calling the generated `getDB(namespace)`
 * runs unchanged and its queries execute as real SQL on an in-memory
 * Postgres. Restored on dispose; the PGlite instances are borrowed, never
 * closed — close them yourself (e.g. in `afterAll`).
 *
 * Create the tables a test needs up front with `CREATE TABLE` statements
 * matching the generated Kysely types. PGlite runs full PostgreSQL while
 * TailorDB supports a subset of it, so a statement passing here can still be
 * rejected by the platform.
 *
 * Transactions on a shared instance are serialized: while one is open,
 * queries from other `getDB` instances on the same PGlite instance wait for
 * it to finish. Do not run such tests with `test.concurrent`, and do not
 * query the same instance through a second `getDB` from inside a transaction
 * — that waits on itself.
 * @param options - PGlite instance registration per namespace
 * @returns Disposable TailorDB mock control object
 * @example
 * ```typescript
 * import { PGlite } from "@electric-sql/pglite";
 * import { mockTailordbWithPGlite } from "@tailor-platform/sdk/vitest";
 * import { getDB } from "../generated/tailordb";
 *
 * const pglite = new PGlite();
 * afterAll(() => pglite.close());
 *
 * test("real SQL", async () => {
 *   using _db = mockTailordbWithPGlite({ namespaces: { tailordb: pglite } });
 *   await pglite.query(`CREATE TABLE "User" ("id" uuid PRIMARY KEY, "name" text NOT NULL)`);
 *   await getDB("tailordb").insertInto("User").values({ id: crypto.randomUUID(), name: "a" }).execute();
 * });
 * ```
 */
export function mockTailordbWithPGlite(options: MockTailordbPGliteOptions) {
  const root = tailordbRoot();
  const prevClient = root.Client;

  const executedQueries: ExecutedPGliteQuery[] = [];
  const createdClients: CreatedClient[] = [];
  const locks = new Map<PGliteClient, TransactionLock>();

  const defaultClient = function (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this: any,
    config?: { namespace?: string },
  ) {
    const namespace = config?.namespace;
    const pglite = namespace === undefined ? undefined : options.namespaces[namespace];
    if (namespace === undefined || !pglite) {
      throw new Error(
        `mockTailordbWithPGlite: no PGlite instance registered for namespace "${namespace}"`,
      );
    }
    const lock = locks.get(pglite) ?? new TransactionLock();
    locks.set(pglite, lock);

    const record: CreatedClient = { namespace, ended: false };
    createdClients.push(record);

    const self = this as object;
    const run = async (query: string, params?: unknown[]) => {
      executedQueries.push({ namespace, query, params: params ?? [] });
      return toQueryObjectResult(await pglite.query(query, params ?? []));
    };

    const throwEnded = (): never => {
      throw new Error("mockTailordbWithPGlite: query after end() on this client");
    };
    // Rechecked after every acquire: end() can resolve while the query is
    // still waiting for the lock.
    const acquire = async () => {
      await lock.acquire(self);
      if (record.ended) {
        lock.release(self);
        throwEnded();
      }
    };

    const queryObject = async (query: string, params?: unknown[]) => {
      if (record.ended) throwEnded();
      if (BEGIN_PATTERN.test(query)) {
        await acquire();
        try {
          return await run(query, params);
        } catch (error) {
          lock.release(self);
          throw error;
        }
      }
      if (END_PATTERN.test(query)) {
        try {
          return await run(query, params);
        } finally {
          lock.release(self);
        }
      }
      if (lock.holds(self)) {
        return await run(query, params);
      }
      await acquire();
      try {
        return await run(query, params);
      } finally {
        lock.release(self);
      }
    };

    this.connect = async (): Promise<void> => {};
    this.end = async (): Promise<void> => {
      record.ended = true;
      if (lock.holds(self)) {
        try {
          await run("rollback");
        } finally {
          lock.release(self);
        }
      }
    };
    this.queryObject = queryObject;
    this.createTransaction = (name: string) => {
      if (!name) {
        throw new Error("Transaction name must be a non-empty string");
      }
      return {
        begin: () => queryObject("begin"),
        commit: () => queryObject("commit"),
        rollback: () => queryObject("rollback"),
        queryObject,
      };
    };
  };
  const Client = vi.fn(defaultClient);

  root.Client = Client;

  const facade = {
    /** The mock `tailordb.Client` constructor (`vi.fn`). */
    Client,

    /**
     * All queries executed on the PGlite instances, in order, with the
     * namespace that issued each.
     * @returns Executed queries array
     */
    get executedQueries(): ExecutedPGliteQuery[] {
      return executedQueries;
    },

    /**
     * All TailorDB clients created, with their namespace and end state.
     * @returns Created clients array
     */
    get createdClients(): CreatedClient[] {
      return createdClients;
    },

    /** Clear recorded queries and clients while keeping the mock installed. */
    clear(): void {
      Client.mockClear();
      executedQueries.length = 0;
      createdClients.length = 0;
    },
  };

  return withDispose(facade, () => {
    root.Client = prevClient;
  });
}
