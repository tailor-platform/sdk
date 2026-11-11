import { expect, test, vi } from "vitest";
import { logger } from "#/cli/shared/logger";
import { emptyPlanResults } from "./test-helpers/plan-results";
import { validatePlans } from "./validate-plan";

vi.mock("@bufbuild/protovalidate", () => ({
  createValidator: () => ({
    validate: () => ({ kind: "error", error: new Error("boom") }),
  }),
}));

test("identifies each application in evaluator warnings without blocking deployment", async () => {
  using warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
  const plans = ["app-a", "app-b"].map((application) => {
    const results = emptyPlanResults();
    results.tailorDB.changeSet.type.creates.push({
      name: "User",
      request: {
        workspaceId: "00000000-0000-0000-0000-000000000001",
        namespaceName: "main",
        tailordbType: { name: "User" },
      },
    } as never);
    return { application, results };
  });

  await expect(validatePlans(plans)).resolves.toBeUndefined();
  expect(warnSpy.mock.calls).toEqual([
    ['Application "app-a": Could not validate TailorDB table "User" (create): boom'],
    ['Application "app-b": Could not validate TailorDB table "User" (create): boom'],
  ]);
});
