import { createKyselyMock } from "@tailor-platform/sdk/vitest";
import { describe, expect, test } from "vitest";
import { main } from "./migrate";
import type { Database } from "./db";

describe("0001 backfill updatedAt", () => {
  test("backfills updatedAt from createdAt on Event", async () => {
    const mock = createKyselyMock<Database>();

    await mock.withTx((trx) => main(trx));

    expect(mock.executedQueries).toHaveLength(1);
    expect(mock.updates).toHaveLength(1);
    const [update] = mock.updates;
    expect(update?.sql).toContain('set "updatedAt" = "createdAt"');
    expect(update?.sql).toContain('where "updatedAt" is null');
  });
});
