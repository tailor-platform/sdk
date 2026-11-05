import { describe, expect, test } from "vitest";
import { assertInvokersSurviveDeploy } from "./invoker-validation";
import { dropCrossDeploymentManagedDeletes } from "./managed-resources";
import { emptyPlanResults } from "./test-helpers/plan-results";
import type { PlanResults, PlannedDeployment } from "./apply-phases";

function plannedDeployment(name: string, results: PlanResults): PlannedDeployment {
  return { application: { name }, ...results } as unknown as PlannedDeployment;
}

function resultsThatDelete(authNamespace: string) {
  const results = emptyPlanResults();
  results.auth.changeSet.service.deletes.push({ name: authNamespace } as never);
  return results;
}

function resultsReferencing(authNamespace: string) {
  const results = emptyPlanResults();
  results.pipeline.invokerReferences.push({
    namespace: authNamespace,
    machineUserName: "portal",
    context: 'Resolver "ping"',
  });
  return results;
}

describe("assertInvokersSurviveDeploy", () => {
  test("rejects an invoker whose Auth service another config in the run deletes", () => {
    expect(() =>
      assertInvokersSurviveDeploy([
        plannedDeployment("owner", resultsThatDelete("old-auth")),
        plannedDeployment("portal", resultsReferencing("old-auth")),
      ]),
    ).toThrow(
      expect.objectContaining({
        code: "INVOKER_MACHINE_USER_NOT_FOUND",
        message: expect.stringContaining('Resolver "ping"'),
        context: expect.objectContaining({ authNamespace: "old-auth", invoker: "portal" }),
      }),
    );
  });

  test("rejects an executor invoker whose Auth service the run deletes", () => {
    const referencing = emptyPlanResults();
    referencing.executor.invokerReferences.push({
      namespace: "old-auth",
      machineUserName: "batch",
      context: 'Executor "nightly"',
    });

    expect(() =>
      assertInvokersSurviveDeploy([
        plannedDeployment("owner", resultsThatDelete("old-auth")),
        plannedDeployment("portal", referencing),
      ]),
    ).toThrow(expect.objectContaining({ message: expect.stringContaining('Executor "nightly"') }));
  });

  test("accepts an invoker whose Auth service the run keeps", () => {
    expect(() =>
      assertInvokersSurviveDeploy([
        plannedDeployment("owner", resultsThatDelete("other-auth")),
        plannedDeployment("portal", resultsReferencing("old-auth")),
      ]),
    ).not.toThrow();
  });

  test("accepts an invoker whose Auth service another config in the run defines again", () => {
    const previousOwner = resultsThatDelete("old-auth");
    const nextOwner = emptyPlanResults();
    nextOwner.auth.changeSet.service.updates.push({ name: "old-auth" } as never);
    const deployments = [
      plannedDeployment("previous", previousOwner),
      plannedDeployment("next", nextOwner),
      plannedDeployment("portal", resultsReferencing("old-auth")),
    ];

    dropCrossDeploymentManagedDeletes(deployments);

    expect(() => assertInvokersSurviveDeploy(deployments)).not.toThrow();
  });
});
