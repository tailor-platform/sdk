/**
 * Migration script for tailordb
 *
 * This script handles data migration for breaking schema changes.
 * Edit this file to implement your data migration logic.
 *
 * The transaction is managed by the apply command.
 * If any operation fails, all changes will be rolled back.
 */

import type { Transaction } from "./db";

export async function main(trx: Transaction): Promise<void> {
  // Ensure name values are unique before adding constraint
  const duplicates = await trx
    .selectFrom("User")
    .select(["name"])
    .groupBy("name")
    .having((eb) => eb.fn.count("id"), ">", 1)
    .execute();

  // For each duplicate name, add suffix to make them unique
  for (const dup of duplicates) {
    const records = await trx
      .selectFrom("User")
      .select(["id", "name"])
      .where("name", "=", dup.name)
      .execute();

    // Keep first record as-is, add suffix to others
    for (let i = 1; i < records.length; i++) {
      await trx
        .updateTable("User")
        .set({ name: `${records[i].name}_${i}` })
        .where("id", "=", records[i].id)
        .execute();
    }
  }
}
