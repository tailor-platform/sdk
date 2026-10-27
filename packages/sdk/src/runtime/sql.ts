/**
 * Queries imported from `.sql` files.
 *
 * Importing a `.sql` file from a function gives a {@link SqlQuery} whose
 * parameter and row types come from your TailorDB definitions. Run it on a
 * `tailordb.Client` (or a transaction from one) created for the query's
 * namespace.
 * @example
 * import getOrders from "./get_orders.sql";
 *
 * const client = new tailordb.Client({ namespace: getOrders.namespace });
 * await client.connect();
 * const orders = await getOrders.run(client, { status: "PAID" });
 */

/**
 * How many rows a query returns: any number (`many`), at most one
 * (`maybeOne`), exactly one (`one`), or none (`none`).
 */
export type SqlCardinality = "many" | "maybeOne" | "one" | "none";

/** What {@link SqlQuery.run} needs from a `tailordb.Client` or one of its transactions. */
export interface SqlClient {
  queryObject<T>(sql: string, args?: readonly unknown[]): Promise<{ rows: T[] }>;
}

/** What {@link SqlQuery.run} resolves to for each {@link SqlCardinality}. */
export type SqlResult<Row, Cardinality extends SqlCardinality> = Cardinality extends "many"
  ? Row[]
  : Cardinality extends "maybeOne"
    ? Row | null
    : Cardinality extends "one"
      ? Row
      : void;

/** A statement imported from a `.sql` file. */
export interface SqlQuery<Params, Row, Cardinality extends SqlCardinality> {
  /** TailorDB namespace of the tables the statement reads and writes. */
  readonly namespace: string;
  /** The statement as sent, with each `:name` placeholder replaced by `$n`. */
  readonly sql: string;
  /**
   * Run the statement.
   * @param client - A `tailordb.Client` for {@link SqlQuery.namespace}, or a transaction from one
   * @param params - A value for each `:name` placeholder, when the statement has any
   * @returns The rows, shaped by how many the statement can return
   */
  run(
    client: SqlClient,
    ...params: keyof Params extends never ? [] : [params: Params]
  ): Promise<SqlResult<Row, Cardinality>>;
}

/** The analyzed statement a `.sql` import is built from. */
export interface SqlQueryDefinition {
  namespace: string;
  sql: string;
  /** The placeholder name each `$n` of `sql` binds, in order. */
  paramNames: readonly string[];
  cardinality: SqlCardinality;
}

/**
 * Create the query a `.sql` import resolves to. The SDK calls this in the code
 * it generates for each imported `.sql` file.
 * @param definition - The analyzed statement
 * @returns The runnable query
 */
export function createSqlQuery<Params, Row, Cardinality extends SqlCardinality>(
  definition: SqlQueryDefinition,
): SqlQuery<Params, Row, Cardinality> {
  const { namespace, sql, paramNames, cardinality } = definition;
  async function run(client: SqlClient, params?: Record<string, unknown>): Promise<unknown> {
    const args = paramNames.map((name) => params?.[name]);
    const { rows } = await client.queryObject<Row>(sql, args);
    if (cardinality === "many") return rows;
    if (cardinality === "none") return undefined;
    if (rows.length > 1 || (cardinality === "one" && rows.length === 0)) {
      throw new Error(
        `The query in namespace "${namespace}" returned ${rows.length} rows; its type allows ${cardinality === "one" ? "exactly one" : "at most one"}`,
      );
    }
    return rows[0] ?? null;
  }
  return { namespace, sql, run } as SqlQuery<Params, Row, Cardinality>;
}
