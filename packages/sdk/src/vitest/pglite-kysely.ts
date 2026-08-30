/**
 * Kysely adapter for running migration scripts against PGlite.
 *
 * Accepts the PGlite client structurally so the SDK does not depend on
 * `@electric-sql/pglite`; users install it themselves as a devDependency.
 */

import {
  type ColumnType,
  CompiledQuery,
  type DatabaseConnection,
  type Dialect,
  type Driver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type QueryResult,
  type TransactionSettings,
} from "kysely";

/**
 * The subset of a `@electric-sql/pglite` `PGlite` instance used by
 * {@link createKyselyPGlite}. Any client with a compatible `query`/`close`
 * pair works.
 */
export interface PGliteClient {
  /** Run a single SQL statement with positional (`$1`, `$2`, ...) parameters. */
  query(query: string, params?: unknown[]): Promise<{ rows: unknown[]; affectedRows?: number }>;
  /** Release the underlying database. Called by `db.destroy()`. */
  close(): Promise<void>;
}

class PGliteConnection implements DatabaseConnection {
  readonly #client: PGliteClient;

  constructor(client: PGliteClient) {
    this.#client = client;
  }

  async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    const result = await this.#client.query(compiledQuery.sql, [...compiledQuery.parameters]);
    return {
      rows: result.rows as R[],
      numAffectedRows: BigInt(result.affectedRows ?? 0),
    };
  }

  streamQuery(): AsyncIterableIterator<QueryResult<never>> {
    throw new Error("createKyselyPGlite: streaming is not supported");
  }
}

class PGliteDriver implements Driver {
  readonly #client: PGliteClient;

  constructor(client: PGliteClient) {
    this.#client = client;
  }

  async init(): Promise<void> {}

  async acquireConnection(): Promise<DatabaseConnection> {
    return new PGliteConnection(this.#client);
  }

  async beginTransaction(
    connection: DatabaseConnection,
    settings: TransactionSettings,
  ): Promise<void> {
    const parts = settings.isolationLevel
      ? ["start transaction", `isolation level ${settings.isolationLevel}`]
      : ["begin"];
    if (settings.accessMode) {
      parts.push(settings.accessMode);
    }
    await connection.executeQuery(CompiledQuery.raw(parts.join(" ")));
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw("commit"));
  }

  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw("rollback"));
  }

  async releaseConnection(): Promise<void> {}

  async destroy(): Promise<void> {
    await this.#client.close();
  }
}

type WritableAs<S, W> = [S] extends [W] ? W : [W] extends [S] ? S : W | Exclude<S, W>;
type UnmigratedColumn<C> =
  C extends ColumnType<infer S, infer I, infer U>
    ? ColumnType<S, WritableAs<S, I>, WritableAs<S, U>>
    : C;

/**
 * `DB` as its rows stand before the migration script has run: every column
 * accepts on insert and update whatever it can still hold on read.
 *
 * The generated `db.ts` types a column the migration makes required as
 * `ColumnType<T | null, T, T>`, and an enum whose values it narrows as
 * `ColumnType<Before, After, After>`, so `migrate.ts` cannot write a null
 * or a removed value into them — and neither can a test that has to stage
 * the rows the script converts. Type the PGlite instance with
 * `Unmigrated<Database>` to stage them; `main` still receives a
 * `Transaction<Database>`.
 * @example
 * ```typescript
 * const db = createKyselyPGlite<Unmigrated<Database>>(new PGlite());
 * await db.insertInto("User").values({ name: "a", email: null }).execute();
 * await db.transaction().execute((trx) => main(trx));
 * ```
 */
export type Unmigrated<DB> = {
  [T in keyof DB]: { [C in keyof DB[T]]: UnmigratedColumn<DB[T][C]> };
};

/**
 * Create a Kysely instance backed by a PGlite in-memory Postgres, for
 * executing a migration script's queries against real data in tests.
 * Pass the migration's schema as the type argument — wrapped in
 * {@link Unmigrated} so the test can stage the rows the script has not yet
 * backfilled: `createKyselyPGlite<Unmigrated<Database>>(new PGlite())`.
 *
 * PGlite runs full PostgreSQL while TailorDB supports a subset of it, so a
 * statement passing here can still be rejected by the platform; keep a
 * statement-level test (see `createKyselyMock`) alongside.
 * @param client - A `PGlite` instance from `@electric-sql/pglite`
 * @returns A Kysely instance that executes queries on the client and closes it on `destroy()`
 * @example
 * ```typescript
 * // migrations/0005/migrate.pglite.test.ts
 * import { PGlite } from "@electric-sql/pglite";
 * import { createKyselyPGlite, type Unmigrated } from "@tailor-platform/sdk/vitest";
 * import type { Database } from "./db";
 * import { main } from "./migrate";
 *
 * const db = createKyselyPGlite<Unmigrated<Database>>(new PGlite());
 * // create tables matching db.ts, insert rows, then:
 * await db.transaction().execute((trx) => main(trx));
 * ```
 */
export function createKyselyPGlite<DB = Record<string, never>>(client: PGliteClient): Kysely<DB> {
  const dialect: Dialect = {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new PGliteDriver(client),
    createIntrospector: (db) => new PostgresIntrospector(db),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  };
  return new Kysely<DB>({ dialect });
}
