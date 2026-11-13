import { Subgraph_ServiceType } from "@tailor-platform/tailor-proto/application_resource_pb";
import { describe, expect, test } from "vitest";
import { dropCrossDeploymentManagedDeletes } from "./managed-resources";
import { assertServicesNotInUse } from "./services-in-use";
import { emptyPlanResults } from "./test-helpers/plan-results";
import type { PlanResults, PlannedDeployment } from "./apply-phases";

type ApplicationShape = {
  name: string;
  subgraphs?: Array<{ Type: string; Name: string }>;
  authService?: { config: { name: string } };
  config?: { auth: { name: string; external: true } };
};

type WorkspaceApplication = {
  name: string;
  authNamespace?: string;
  subgraphs?: Array<{ serviceType: Subgraph_ServiceType; serviceNamespace: string }>;
};

function deployment(application: ApplicationShape, results: PlanResults) {
  return {
    application: { subgraphs: [], ...application },
    ...results,
  } as unknown as PlannedDeployment;
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

function withWorkspaceApplications(results: PlanResults, applications: WorkspaceApplication[]) {
  results.app.existingApplications = applications.map((application) => ({
    authNamespace: "",
    subgraphs: [],
    ...application,
  })) as never;
  return results;
}

const SUBGRAPH_SERVICES = [
  {
    label: "TailorDB namespace",
    resourceType: "tailordb.service",
    configType: "tailordb",
    serviceType: Subgraph_ServiceType.TAILORDB,
    deletesOf: (results: PlanResults) => results.tailorDB.changeSet.service.deletes,
  },
  {
    label: "Resolver namespace",
    resourceType: "pipeline.service",
    configType: "pipeline",
    serviceType: Subgraph_ServiceType.PIPELINE,
    deletesOf: (results: PlanResults) => results.pipeline.changeSet.service.deletes,
  },
  {
    label: "IdP service",
    resourceType: "idp.service",
    configType: "idp",
    serviceType: Subgraph_ServiceType.IDP,
    deletesOf: (results: PlanResults) => results.idp.changeSet.service.deletes,
  },
];

describe("assertServicesNotInUse", () => {
  test("rejects a deleted Auth service that an application outside the run still uses", () => {
    const owner = withWorkspaceApplications(ownerDeleting("shared-auth"), [
      { name: "portal", authNamespace: "shared-auth" },
    ]);

    expect(() => assertServicesNotInUse([deployment({ name: "core" }, owner)], "deploy")).toThrow(
      expect.objectContaining({
        code: "SERVICE_IN_USE",
        message:
          'Auth service "shared-auth" cannot be deleted: application "portal" still uses it.',
        suggestion: expect.stringContaining("first or in the same run"),
        context: {
          uses: [{ resourceType: "auth.service", name: "shared-auth", application: "portal" }],
        },
      }),
    );
  });

  test("reports each application that uses a deleted Auth service once", () => {
    const workspaceApplications = [
      { name: "portal", authNamespace: "shared-auth" },
      { name: "admin", authNamespace: "shared-auth" },
    ];
    const owner = withWorkspaceApplications(ownerDeleting("shared-auth"), workspaceApplications);
    const peer = withWorkspaceApplications(emptyPlanResults(), workspaceApplications);

    expect(() =>
      assertServicesNotInUse(
        [deployment({ name: "core" }, owner), deployment({ name: "billing" }, peer)],
        "deploy",
      ),
    ).toThrow(
      expect.objectContaining({
        message: [
          'Auth service "shared-auth" cannot be deleted: application "portal" still uses it.',
          'Auth service "shared-auth" cannot be deleted: application "admin" still uses it.',
        ].join("\n"),
      }),
    );
  });

  test("rejects a deleted Auth service that another config in the run still references", () => {
    expect(() =>
      assertServicesNotInUse(
        [
          deployment({ name: "core" }, ownerDeleting("shared-auth")),
          deployment(referencingExternally("shared-auth"), plannedApplication("portal")),
        ],
        "deploy",
      ),
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
      assertServicesNotInUse(
        [
          deployment({ name: "core" }, owner),
          deployment({ name: "portal" }, plannedApplication("portal")),
        ],
        "deploy",
      ),
    ).not.toThrow();
  });

  test("rejects an application of the run whose gateway the plan does not rewrite", () => {
    const owner = withWorkspaceApplications(ownerDeleting("shared-auth"), [
      { name: "portal", authNamespace: "shared-auth" },
    ]);

    expect(() =>
      assertServicesNotInUse(
        [deployment({ name: "core" }, owner), deployment({ name: "portal" }, emptyPlanResults())],
        "deploy",
      ),
    ).toThrow(expect.objectContaining({ code: "SERVICE_IN_USE" }));
  });

  test("accepts an application that the run deletes", () => {
    const owner = withWorkspaceApplications(ownerDeleting("shared-auth"), [
      { name: "legacy", authNamespace: "shared-auth" },
    ]);
    owner.app.deletes.push({ name: "legacy", request: {} });

    expect(() =>
      assertServicesNotInUse([deployment({ name: "core" }, owner)], "deploy"),
    ).not.toThrow();
  });

  test("accepts a deleted Auth service that no application uses", () => {
    const owner = withWorkspaceApplications(ownerDeleting("shared-auth"), [
      { name: "portal", authNamespace: "other-auth" },
    ]);

    expect(() =>
      assertServicesNotInUse([deployment({ name: "core" }, owner)], "deploy"),
    ).not.toThrow();
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

    expect(() => assertServicesNotInUse(deployments, "deploy")).not.toThrow();
  });

  test("ignores applications when the run deletes no service", () => {
    const owner = withWorkspaceApplications(emptyPlanResults(), [
      {
        name: "portal",
        authNamespace: "shared-auth",
        subgraphs: [{ serviceType: Subgraph_ServiceType.TAILORDB, serviceNamespace: "main" }],
      },
    ]);

    expect(() =>
      assertServicesNotInUse([deployment({ name: "core" }, owner)], "deploy"),
    ).not.toThrow();
  });

  test.each(SUBGRAPH_SERVICES)(
    "rejects a deleted $label that an application outside the run lists as a subgraph",
    ({ label, resourceType, serviceType, deletesOf }) => {
      const owner = withWorkspaceApplications(emptyPlanResults(), [
        { name: "viewer", subgraphs: [{ serviceType, serviceNamespace: "shared" }] },
      ]);
      deletesOf(owner).push({ name: "shared" } as never);

      expect(() =>
        assertServicesNotInUse([deployment({ name: "owner" }, owner)], "remove"),
      ).toThrow(
        expect.objectContaining({
          code: "SERVICE_IN_USE",
          message: `${label} "shared" cannot be deleted: application "viewer" still uses it.`,
          context: { uses: [{ resourceType, name: "shared", application: "viewer" }] },
        }),
      );
    },
  );

  test.each(SUBGRAPH_SERVICES)(
    "rejects a deleted $label that another config in the run references",
    ({ label, configType, deletesOf }) => {
      const owner = emptyPlanResults();
      deletesOf(owner).push({ name: "shared" } as never);

      expect(() =>
        assertServicesNotInUse(
          [
            deployment({ name: "owner" }, owner),
            deployment(
              {
                name: "viewer",
                subgraphs: [
                  { Type: "auth", Name: "shared" },
                  { Type: configType, Name: "shared" },
                ],
              },
              plannedApplication("viewer"),
            ),
          ],
          "deploy",
        ),
      ).toThrow(
        expect.objectContaining({
          message: `${label} "shared" cannot be deleted: application "viewer" still uses it.`,
        }),
      );
    },
  );

  test.each(SUBGRAPH_SERVICES)(
    "accepts an application of the run whose config no longer lists the deleted $label",
    ({ serviceType, deletesOf }) => {
      const owner = withWorkspaceApplications(emptyPlanResults(), [
        { name: "viewer", subgraphs: [{ serviceType, serviceNamespace: "shared" }] },
      ]);
      deletesOf(owner).push({ name: "shared" } as never);

      expect(() =>
        assertServicesNotInUse(
          [
            deployment({ name: "owner" }, owner),
            deployment({ name: "viewer" }, plannedApplication("viewer")),
          ],
          "deploy",
        ),
      ).not.toThrow();
    },
  );

  test.each(SUBGRAPH_SERVICES)(
    "rejects an application of the run whose gateway keeps listing the deleted $label",
    ({ serviceType, deletesOf }) => {
      const owner = withWorkspaceApplications(emptyPlanResults(), [
        { name: "viewer", subgraphs: [{ serviceType, serviceNamespace: "shared" }] },
      ]);
      deletesOf(owner).push({ name: "shared" } as never);

      expect(() =>
        assertServicesNotInUse(
          [
            deployment({ name: "owner" }, owner),
            deployment({ name: "viewer" }, emptyPlanResults()),
          ],
          "deploy",
        ),
      ).toThrow(expect.objectContaining({ code: "SERVICE_IN_USE" }));
    },
  );

  test.each(SUBGRAPH_SERVICES)(
    "accepts a deleted $label that only an application the run deletes lists",
    ({ serviceType, deletesOf }) => {
      const owner = withWorkspaceApplications(emptyPlanResults(), [
        { name: "owner", subgraphs: [{ serviceType, serviceNamespace: "shared" }] },
      ]);
      owner.app.deletes.push({ name: "owner", request: {} });
      deletesOf(owner).push({ name: "shared" } as never);

      expect(() =>
        assertServicesNotInUse([deployment({ name: "owner" }, owner)], "remove"),
      ).not.toThrow();
    },
  );

  test("reports every deleted service an application uses in one error", () => {
    const owner = withWorkspaceApplications(ownerDeleting("shared-auth"), [
      {
        name: "viewer",
        authNamespace: "shared-auth",
        subgraphs: [{ serviceType: Subgraph_ServiceType.TAILORDB, serviceNamespace: "main" }],
      },
    ]);
    owner.tailorDB.changeSet.service.deletes.push({ name: "main" } as never);

    expect(() => assertServicesNotInUse([deployment({ name: "owner" }, owner)], "remove")).toThrow(
      expect.objectContaining({
        message: [
          'Auth service "shared-auth" cannot be deleted: application "viewer" still uses it.',
          'TailorDB namespace "main" cannot be deleted: application "viewer" still uses it.',
        ].join("\n"),
        suggestion:
          "Remove the applications that use each listed service, or deploy them without that service, then run remove again.",
      }),
    );
  });

  test("matches a use only against deleted services of the same kind", () => {
    const owner = withWorkspaceApplications(ownerDeleting("shared-auth"), [
      {
        name: "viewer",
        authNamespace: "shared-auth",
        subgraphs: [
          { serviceType: Subgraph_ServiceType.AUTH, serviceNamespace: "shared-auth" },
          { serviceType: Subgraph_ServiceType.IDP, serviceNamespace: "main" },
          { serviceType: Subgraph_ServiceType.PIPELINE, serviceNamespace: "main" },
        ],
      },
    ]);
    owner.tailorDB.changeSet.service.deletes.push({ name: "main" } as never);

    expect(() => assertServicesNotInUse([deployment({ name: "owner" }, owner)], "remove")).toThrow(
      expect.objectContaining({
        message:
          'Auth service "shared-auth" cannot be deleted: application "viewer" still uses it.',
      }),
    );
  });
});
