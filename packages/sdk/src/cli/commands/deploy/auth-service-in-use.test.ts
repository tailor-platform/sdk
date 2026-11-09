import { describe, expect, test } from "vitest";
import { assertAuthServicesNotInUse } from "./auth-service-in-use";
import { dropCrossDeploymentManagedDeletes } from "./managed-resources";
import { emptyPlanResults } from "./test-helpers/plan-results";
import type { PlanResults, PlannedDeployment } from "./apply-phases";

type ApplicationShape = {
  name: string;
  authService?: { config: { name: string } };
  config?: { auth: { name: string; external: true } };
};

function deployment(application: ApplicationShape, results: PlanResults) {
  return { application, ...results } as unknown as PlannedDeployment;
}

function ownerDeleting(authNamespace: string) {
  const results = emptyPlanResults();
  results.auth.changeSet.service.deletes.push({ name: authNamespace } as never);
  return results;
}

function referencingExternally(authNamespace: string): ApplicationShape {
  return { name: "portal", config: { auth: { name: authNamespace, external: true } } };
}

function plannedApplication(name: string) {
  const results = emptyPlanResults();
  results.app.unchanged.push({ name } as never);
  return results;
}

function withWorkspaceApplications(
  results: PlanResults,
  applications: Array<{ name: string; authNamespace: string }>,
) {
  results.app.existingApplications = applications as never;
  return results;
}

describe("assertAuthServicesNotInUse", () => {
  test("rejects a deleted Auth service that an application outside the run still uses", () => {
    const owner = withWorkspaceApplications(ownerDeleting("shared-auth"), [
      { name: "portal", authNamespace: "shared-auth" },
    ]);

    expect(() => assertAuthServicesNotInUse([deployment({ name: "core" }, owner)])).toThrow(
      expect.objectContaining({
        code: "SERVICE_IN_USE",
        message: expect.stringContaining('application "portal"'),
        context: expect.objectContaining({
          resourceType: "auth.service",
          namespace: "shared-auth",
          application: "portal",
        }),
      }),
    );
  });

  test("rejects a deleted Auth service that another config in the run still references", () => {
    expect(() =>
      assertAuthServicesNotInUse([
        deployment({ name: "core" }, ownerDeleting("shared-auth")),
        deployment(referencingExternally("shared-auth"), plannedApplication("portal")),
      ]),
    ).toThrow(
      expect.objectContaining({
        code: "SERVICE_IN_USE",
        message: expect.stringContaining('application "portal"'),
      }),
    );
  });

  test("accepts an application of the run that no longer references the deleted Auth service", () => {
    const owner = withWorkspaceApplications(ownerDeleting("shared-auth"), [
      { name: "core", authNamespace: "shared-auth" },
      { name: "portal", authNamespace: "shared-auth" },
    ]);
    owner.app.updates.push({ name: "core" } as never);

    expect(() =>
      assertAuthServicesNotInUse([
        deployment({ name: "core" }, owner),
        deployment({ name: "portal" }, plannedApplication("portal")),
      ]),
    ).not.toThrow();
  });

  test("rejects an application of the run whose gateway the plan does not rewrite", () => {
    const owner = withWorkspaceApplications(ownerDeleting("shared-auth"), [
      { name: "portal", authNamespace: "shared-auth" },
    ]);

    expect(() =>
      assertAuthServicesNotInUse([
        deployment({ name: "core" }, owner),
        deployment({ name: "portal" }, emptyPlanResults()),
      ]),
    ).toThrow(expect.objectContaining({ code: "SERVICE_IN_USE" }));
  });

  test("accepts an application that the run deletes", () => {
    const owner = withWorkspaceApplications(ownerDeleting("shared-auth"), [
      { name: "legacy", authNamespace: "shared-auth" },
    ]);
    owner.app.deletes.push({ name: "legacy", request: {} });

    expect(() => assertAuthServicesNotInUse([deployment({ name: "core" }, owner)])).not.toThrow();
  });

  test("accepts a deleted Auth service that no application uses", () => {
    const owner = withWorkspaceApplications(ownerDeleting("shared-auth"), [
      { name: "portal", authNamespace: "other-auth" },
    ]);

    expect(() => assertAuthServicesNotInUse([deployment({ name: "core" }, owner)])).not.toThrow();
  });

  test("accepts an application that another config in the run defines the Auth service for again", () => {
    const previousOwner = ownerDeleting("shared-auth");
    const nextOwner = emptyPlanResults();
    nextOwner.auth.changeSet.service.updates.push({ name: "shared-auth" } as never);
    const deployments = [
      deployment({ name: "previous" }, previousOwner),
      deployment({ name: "next" }, nextOwner),
      deployment(referencingExternally("shared-auth"), plannedApplication("portal")),
    ];

    dropCrossDeploymentManagedDeletes(deployments);

    expect(() => assertAuthServicesNotInUse(deployments)).not.toThrow();
  });

  test("ignores applications when the run deletes no Auth service", () => {
    const owner = withWorkspaceApplications(emptyPlanResults(), [
      { name: "portal", authNamespace: "shared-auth" },
    ]);

    expect(() => assertAuthServicesNotInUse([deployment({ name: "core" }, owner)])).not.toThrow();
  });
});
