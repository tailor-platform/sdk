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
  // Set default name for Supplier records where it is null
  await trx
    .updateTable("Supplier")
    .set({
      name: "Unknown Supplier",
    })
    .where("name", "is", null)
    .execute();

  // Set default country for Supplier records where it is null
  await trx
    .updateTable("Supplier")
    .set({
      country: "Unknown",
    })
    .where("country", "is", null)
    .execute();

  // Migrate records with removed enum values: UNKNOWN
  await trx.updateTable("User").set({ role: "MANAGER" }).where("role", "in", ["UNKNOWN"]).execute();
}
