import { createKyselyMock } from "@tailor-platform/sdk/vitest";
import { describe, expect, test } from "vitest";
import { main } from "./migrate";
import type { Database } from "./db";

describe("0003 backfill updatedAt", () => {
  test("backfills updatedAt from createdAt on every table", async () => {
    const mock = createKyselyMock<Database>();

    await mock.withTx((trx) => main(trx));

    expect(mock.executedQueries).toHaveLength(9);
    expect(mock.updates).toHaveLength(9);
    for (const update of mock.updates) {
      expect(update.sql).toContain('set "updatedAt" = "createdAt"');
      expect(update.sql).toContain('where "updatedAt" is null');
    }
  });
});
