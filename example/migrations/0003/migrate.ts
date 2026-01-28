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
  // Populate role for existing User records
  await trx
    .updateTable("User")
    .set({
      role: "MANAGER",
    })
    .where("role", "is", null)
    .execute();
}
