interface ExpressionBuilder {
  fn: {
    count: (column: string) => unknown;
  };
}

interface SelectQuery {
  select: (columns: string[]) => SelectQuery;
  groupBy: (column: string) => SelectQuery;
  having: (
    expr: (eb: ExpressionBuilder) => unknown,
    operator: string,
    value: number,
  ) => SelectQuery;
  execute: () => Promise<{ name: string }[]>;
}

interface Transaction {
  selectFrom: (table: string) => SelectQuery;
}

export async function main(trx: Transaction): Promise<void> {
  const duplicates = await trx
    .selectFrom("User")
    .select(["name"])
    .groupBy("name")
    .having((eb) => eb.fn.count("id"), ">", 1)
    .execute();

  if (duplicates.length > 0) {
    const names = duplicates.map((row: { name: string }) => row.name).join(", ");
    throw new Error(`Duplicate User.name values remain: ${names}`);
  }
}
