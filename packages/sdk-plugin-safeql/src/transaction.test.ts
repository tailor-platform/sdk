import { describe, expect, test } from "vitest";
import { sql, type QueryExecutor } from "./sql";
import { transaction } from "./transaction";

function recordingClient(failOn?: { statement: RegExp; error: Error }) {
  const statements: { text: string; values: unknown[] | undefined }[] = [];
  const client: QueryExecutor = {
    async queryObject(text, values) {
      statements.push({ text, values });
      if (failOn?.statement.test(text)) throw failOn.error;
      return { rows: [] };
    },
  };
  return { client, statements, texts: () => statements.map(({ text }) => text) };
}

describe("transaction", () => {
  test("wraps the callback in BEGIN and COMMIT and resolves to its result", async () => {
    const { client, texts } = recordingClient();
    const result = await transaction(client, async () => "done");
    expect(result).toBe("done");
    expect(texts()).toEqual(["BEGIN", "COMMIT"]);
  });

  test("runs statements executed through the transaction handle between BEGIN and COMMIT", async () => {
    const { client, statements } = recordingClient();
    await transaction(client, async (tx) => {
      await sql`UPDATE "Account" SET "age" = ${30} WHERE "id" = ${"a"}`.execute(tx);
    });
    expect(statements).toEqual([
      { text: "BEGIN", values: undefined },
      { text: `UPDATE "Account" SET "age" = $1 WHERE "id" = $2`, values: [30, "a"] },
      { text: "COMMIT", values: undefined },
    ]);
  });

  test("rolls back and rethrows the callback's error without committing", async () => {
    const { client, texts } = recordingClient();
    const failure = new Error("boom");
    await expect(
      transaction(client, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(texts()).toEqual(["BEGIN", "ROLLBACK"]);
  });

  test("rethrows the callback's error even when the rollback also fails", async () => {
    const { client } = recordingClient({ statement: /^ROLLBACK$/, error: new Error("rollback") });
    const failure = new Error("boom");
    await expect(
      transaction(client, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
  });

  test("rolls back and rethrows when the commit fails", async () => {
    const failure = new Error("could not serialize access");
    const { client, texts } = recordingClient({ statement: /^COMMIT$/, error: failure });
    await expect(transaction(client, async () => 1)).rejects.toBe(failure);
    expect(texts()).toEqual(["BEGIN", "COMMIT", "ROLLBACK"]);
  });

  test("does not roll back when the transaction could not be started", async () => {
    const failure = new Error("already in progress");
    const { client, texts } = recordingClient({ statement: /^BEGIN/, error: failure });
    await expect(transaction(client, async () => 1)).rejects.toBe(failure);
    expect(texts()).toEqual(["BEGIN"]);
  });

  test.each([
    [{ isolation: "serializable" }, "BEGIN ISOLATION LEVEL SERIALIZABLE"],
    [{ isolation: "repeatable read" }, "BEGIN ISOLATION LEVEL REPEATABLE READ"],
    [{ readOnly: true }, "BEGIN READ ONLY"],
    [
      { isolation: "read committed", readOnly: true },
      "BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY",
    ],
  ] as const)("starts with the requested characteristics %j", async (options, expected) => {
    const { client, texts } = recordingClient();
    await transaction(client, async () => undefined, options);
    expect(texts()[0]).toBe(expected);
  });

  test("rejects an isolation level it does not know before sending anything", async () => {
    const { client, statements } = recordingClient();
    await expect(
      transaction(client, async () => undefined, {
        isolation: "serializable; DROP TABLE x" as "serializable",
      }),
    ).rejects.toThrow(/isolation/);
    expect(statements).toEqual([]);
  });

  test("refuses to open a second transaction on a client that already has one", async () => {
    const { client, texts } = recordingClient();
    await expect(
      transaction(client, async () => {
        await transaction(client, async () => undefined);
      }),
    ).rejects.toThrow(/already open/);
    expect(texts()).toEqual(["BEGIN", "ROLLBACK"]);
  });

  test("refuses to open a transaction on the handle passed to the callback", async () => {
    const { client, texts } = recordingClient();
    await expect(
      transaction(client, async (tx) => {
        await transaction(tx, async () => undefined);
      }),
    ).rejects.toThrow(/already open/);
    expect(texts()).toEqual(["BEGIN", "ROLLBACK"]);
  });

  test("allows a new transaction on the client once the previous one finished", async () => {
    const { client, texts } = recordingClient();
    await transaction(client, async () => undefined);
    await transaction(client, async () => undefined);
    expect(texts()).toEqual(["BEGIN", "COMMIT", "BEGIN", "COMMIT"]);
  });
});
