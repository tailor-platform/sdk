import {
  setupInvokerMock,
  setupTailorErrorsMock,
  setupTailordbMock,
  unauthenticatedTailorUser,
} from "@tailor-platform/sdk/test";
import { describe, expect, test } from "vitest";
import resolver from "./customerResolver";

describe("customerLookup", () => {
  test("returns a greeting from the mocked database row", async () => {
    setupTailorErrorsMock();
    setupInvokerMock(unauthenticatedTailorUser);
    const db = setupTailordbMock(() => [{ name: "Ada", email: "ada@example.com" }]);

    const result = await resolver.body({
      input: { email: "ada@example.com" },
      user: unauthenticatedTailorUser,
      env: { APP_NAME: "Migration Challenge" },
    });

    expect(result.greeting).toBe("Migration Challenge:Ada");
    expect(db.executedQueries).toHaveLength(1);
  });
});
