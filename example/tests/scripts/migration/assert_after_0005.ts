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
  const supplierCountRow = await trx
    .selectFrom("Supplier")
    .select((eb) => eb.fn.count("id").as("count"))
    .executeTakeFirst();
  const supplierCount = Number(supplierCountRow?.count ?? 0);
  if (supplierCount < 1) {
    throw new Error("Expected at least 1 Supplier record");
  }

  const nameNull = await trx
    .selectFrom("Supplier")
    .select(["id"])
    .where("name", "is", null)
    .execute();
  if (nameNull.length > 0) {
    throw new Error(`Supplier.name is null for ${nameNull.length} record(s)`);
  }

  const countryNull = await trx
    .selectFrom("Supplier")
    .select(["id"])
    .where("country", "is", null)
    .execute();
  if (countryNull.length > 0) {
    throw new Error(`Supplier.country is null for ${countryNull.length} record(s)`);
  }

  const users = await trx.selectFrom("User").select(["id", "role"]).execute();
  const invalidRoles = users.filter((user) => user.role !== "MANAGER" && user.role !== "STAFF");
  if (invalidRoles.length > 0) {
    throw new Error(`User.role invalid for ${invalidRoles.length} record(s)`);
  }
}
