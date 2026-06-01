import { unauthenticatedTailorUser } from "@tailor-platform/sdk/test";
import { createMockKysely, type MockKysely } from "@tailor-platform/sdk/vitest";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { getDB, type Namespace } from "../generated/db";
import resolver from "./upsertUsers";

vi.mock("../generated/db", { spy: true });

describe("upsertUsers resolver", () => {
  let mock: MockKysely<Namespace["main-db"]>;

  beforeEach(() => {
    mock = createMockKysely<Namespace["main-db"]>();
    vi.mocked(getDB).mockReturnValue(mock.db);
  });

  test("inserts new users and updates existing ones", async () => {
    mock.setQueryResolver((query) =>
      query.sql.startsWith("select") && query.parameters.includes("exists@example.com")
        ? [{ id: "user-1" }]
        : [],
    );

    const result = await resolver.body({
      input: {
        users: [
          { name: "Existing", email: "exists@example.com", age: 41 },
          { name: "Newcomer", email: "new@example.com", age: 22 },
        ],
      },
      user: unauthenticatedTailorUser,
      env: { appName: "Resolver Template", version: 1 },
    });

    expect(result).toEqual({ created: 1, updated: 1 });
    expect(mock.selects).toHaveLength(2);
    expect(mock.updates).toHaveLength(1);
    expect(mock.inserts).toHaveLength(1);
    expect(mock.inserts[0].parameters).toEqual(["Newcomer", "new@example.com", 22]);
    expect(mock.executedQueries).toHaveLength(4);
  });
});
