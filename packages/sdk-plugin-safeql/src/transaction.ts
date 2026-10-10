import type { QueryExecutor } from "./sql";

const ISOLATION_LEVELS = ["read committed", "repeatable read", "serializable"] as const;

/** Options for {@link transaction}. */
export interface TransactionOptions {
  /** The isolation level. Defaults to the platform's default. */
  isolation?: (typeof ISOLATION_LEVELS)[number];
  /** Start a read-only transaction. Defaults to `false`. */
  readOnly?: boolean;
}

const open = new WeakSet<QueryExecutor>();

function beginStatement({ isolation, readOnly }: TransactionOptions): string {
  if (isolation !== undefined && !ISOLATION_LEVELS.includes(isolation)) {
    throw new Error(
      `Unknown transaction isolation level "${isolation}". Use one of: ${ISOLATION_LEVELS.join(", ")}.`,
    );
  }
  return [
    "BEGIN",
    ...(isolation ? [`ISOLATION LEVEL ${isolation.toUpperCase()}`] : []),
    ...(readOnly ? ["READ ONLY"] : []),
  ].join(" ");
}

/**
 * Run statements in one transaction: commit when the callback resolves, roll back when it throws.
 * A client can have only one transaction open at a time.
 * @param client - The client to run the transaction on, such as a `tailordb.Client`
 * @param callback - Receives the executor to run the transaction's statements with
 * @param options - Isolation level and read-only mode
 * @returns What the callback resolved to
 */
export async function transaction<T>(
  client: QueryExecutor,
  callback: (tx: QueryExecutor) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const begin = beginStatement(options);
  if (open.has(client)) {
    throw new Error("A transaction is already open on this client; transactions cannot be nested.");
  }
  const handle: QueryExecutor = {
    queryObject: (text, values) => client.queryObject(text, values),
  };
  open.add(client).add(handle);
  try {
    await client.queryObject(begin);
    try {
      const result = await callback(handle);
      await client.queryObject("COMMIT");
      return result;
    } catch (error) {
      await client.queryObject("ROLLBACK").catch(() => undefined);
      throw error;
    }
  } finally {
    open.delete(client);
    open.delete(handle);
  }
}
