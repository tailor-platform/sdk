/**
 * Migration script for analyticsdb
 *
 * This script runs between the Pre-migration and Post-migration phases of
 * 'tailor deploy'. Use it to transform existing data so that the schema
 * change can complete safely (for breaking changes, this is hard-required;
 * for warning-tier changes it is optional). Edit this file to implement
 * your data migration logic.
 *
 * The transaction is managed by the deploy command.
 * If any operation fails, all changes will be rolled back.
 */

import type { Transaction } from "./db";

export async function main(trx: Transaction): Promise<void> {
  await trx
    .updateTable("Event")
    .set((eb) => ({ updatedAt: eb.ref("createdAt") }))
    .where("updatedAt", "is", null)
    .execute();
}
