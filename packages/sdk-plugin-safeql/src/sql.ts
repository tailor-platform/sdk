/** Anything that runs a parameterized statement, such as a `tailordb.Client`. */
export interface QueryExecutor {
  queryObject(text: string, values?: unknown[]): Promise<{ rows?: unknown[] }>;
}

/** A statement and its parameters, ready to run with {@link Query.execute}. */
export interface Query<Row = unknown> {
  /** The statement with `$1`, `$2`, ... in place of each interpolated value. */
  readonly text: string;
  /** The interpolated values, in the order of their placeholders. */
  readonly values: readonly unknown[];
  /**
   * Run the statement.
   * @param executor - Where to run it, for example a `tailordb.Client`
   * @returns The rows the statement returned
   */
  execute(executor: QueryExecutor): Promise<Row[]>;
}

/**
 * Tag a SQL statement so SafeQL can check it against your TailorDB tables.
 * Interpolated values become query parameters, never part of the statement.
 * @param strings - The literal parts of the statement
 * @param values - The interpolated values
 * @returns The statement, to run with `execute`
 */
export function sql<Row = unknown>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Query<Row> {
  const text = strings.reduce((statement, part, index) => `${statement}$${index}${part}`);
  return {
    text,
    values,
    async execute(executor) {
      const { rows } = await executor.queryObject(text, values);
      return (rows ?? []) as Row[];
    },
  };
}
