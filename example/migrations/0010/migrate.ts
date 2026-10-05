/**
 * Migration script for tailordb
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

import { Temporal } from "@tailor-platform/sdk/runtime";
import type { Transaction } from "./db";

export async function main(trx: Transaction): Promise<void> {
  // Populate checkedAt for existing TemporalCheck records, reading eventDatetime
  // back as a Temporal.Instant to verify the migration client is Temporal-aware.
  const rows = await trx.selectFrom("TemporalCheck").select(["id", "eventDatetime"]).execute();
  for (const row of rows) {
    if (!(row.eventDatetime instanceof Temporal.Instant)) {
      throw new Error(
        `Expected eventDatetime to be a Temporal.Instant, got ${typeof row.eventDatetime}`,
      );
    }
    await trx
      .updateTable("TemporalCheck")
      .set({ checkedAt: row.eventDatetime.add({ hours: 1 }) })
      .where("id", "=", row.id)
      .execute();
  }
}
