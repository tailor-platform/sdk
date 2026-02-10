interface ExpressionBuilder {
  fn: {
    count: (column: string) => { as: (alias: string) => unknown };
  };
}

interface SelectQuery {
  select: (arg: ((eb: ExpressionBuilder) => unknown) | string[]) => SelectQuery;
  where: (column: string, operator: string, value: unknown) => SelectQuery;
  execute: () => Promise<Record<string, unknown>[]>;
  executeTakeFirst: () => Promise<Record<string, unknown> | undefined>;
}

interface Transaction {
  selectFrom: (table: string) => SelectQuery;
}

export async function main(trx: Transaction): Promise<void> {
  const countRow = await trx
    .selectFrom("User")
    .select((eb) => eb.fn.count("id").as("count"))
    .executeTakeFirst();
  const count = Number(countRow?.count ?? 0);
  if (count < 3) {
    throw new Error(`Expected at least 3 User records, got ${count}`);
  }

  const missing = await trx.selectFrom("User").select(["id"]).where("role", "is", null).execute();
  if (missing.length > 0) {
    throw new Error(`User.role is null for ${missing.length} record(s)`);
  }
}
