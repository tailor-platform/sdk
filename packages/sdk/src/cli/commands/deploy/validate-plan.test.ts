import { AuthConnection_Type } from "@tailor-proto/tailor/v1/auth_resource_pb";
import { describe, expect, test } from "vitest";
import { createChangeSet } from "./change-set";
import { validatePlan, type ValidatePlanInput } from "./validate-plan";

function emptyInput(): ValidatePlanInput {
  return {
    functionRegistry: {
      changeSet: createChangeSet("Function registry"),
      workflowJobChanges: { creates: [], updates: [], deletes: [], replaces: [], unchanged: [] },
      resolverFunctionChanges: {
        creates: [],
        updates: [],
        deletes: [],
        replaces: [],
        unchanged: [],
      },
      executorFunctionChanges: {
        creates: [],
        updates: [],
        deletes: [],
        replaces: [],
        unchanged: [],
      },
      authHookFunctionChanges: {
        creates: [],
        updates: [],
        deletes: [],
        replaces: [],
        unchanged: [],
      },
      conflicts: [],
      unmanaged: [],
      resourceOwners: new Set(),
    },
    tailorDB: {
      changeSet: {
        service: createChangeSet("TailorDB services"),
        type: createChangeSet("TailorDB types"),
        gqlPermission: createChangeSet("TailorDB gqlPermissions"),
      },
      conflicts: [],
      unmanaged: [],
      resourceOwners: new Set(),
      context: {
        workspaceId: "00000000-0000-0000-0000-000000000001",
        application: {} as ValidatePlanInput["tailorDB"]["context"]["application"],
        tailorDBInputs: [],
        executorUsedTypes: new Set(),
        config: {} as ValidatePlanInput["tailorDB"]["context"]["config"],
        noSchemaCheck: false,
      },
    },
    staticWebsite: {
      changeSet: createChangeSet("StaticWebsites"),
      customDomainChangeSet: createChangeSet("CustomDomains"),
      conflicts: [],
      unmanaged: [],
      resourceOwners: new Set(),
    },
    idp: {
      changeSet: {
        service: createChangeSet("IdP services"),
        client: createChangeSet("IdP clients"),
      },
      conflicts: [],
      unmanaged: [],
      resourceOwners: new Set(),
    },
    auth: {
      changeSet: {
        service: createChangeSet("Auth services"),
        idpConfig: createChangeSet("Auth idpConfigs"),
        userProfileConfig: createChangeSet("Auth userProfileConfigs"),
        tenantConfig: createChangeSet("Auth tenantConfigs"),
        machineUser: createChangeSet("Auth machineUsers"),
        oauth2Client: createChangeSet("Auth oauth2Clients"),
        authHook: createChangeSet("Auth hooks"),
        scim: createChangeSet("Auth scim"),
        scimResource: createChangeSet("Auth scimResources"),
        connection: createChangeSet("Auth connections"),
      },
      conflicts: [],
      unmanaged: [],
      resourceOwners: new Set(),
    },
    pipeline: {
      changeSet: {
        service: createChangeSet("Pipeline services"),
        resolver: createChangeSet("Pipeline resolvers"),
      },
      conflicts: [],
      unmanaged: [],
      resourceOwners: new Set(),
    },
    app: createChangeSet("Applications"),
    executor: {
      changeSet: createChangeSet("Executors"),
      conflicts: [],
      unmanaged: [],
      resourceOwners: new Set(),
    },
    workflow: {
      changeSet: createChangeSet("Workflows"),
      unchangedWorkflowJobNames: new Set(),
      jobFunctionDeletes: [],
      conflicts: [],
      unmanaged: [],
      resourceOwners: new Set(),
      appName: "my-app",
      appId: undefined,
    },
    secretManager: {
      vaultChangeSet: createChangeSet("Vaults"),
      secretChangeSet: createChangeSet("Secrets"),
      skippedSecrets: [],
      conflicts: [],
      unmanaged: [],
      resourceOwners: new Set(),
    },
  } satisfies ValidatePlanInput;
}

const WS_ID = "00000000-0000-0000-0000-000000000001";

describe("validatePlan", () => {
  test("(a) empty plan with no creates or updates passes", async () => {
    await expect(validatePlan(emptyInput())).resolves.toBeUndefined();
  });

  test("(b) TailorDB type name violating ^[A-Z][a-zA-Z0-9]{0,62}$ produces a violation", async () => {
    const input = emptyInput();
    input.tailorDB.changeSet.type.creates.push({
      name: "invalidLowercaseName",
      request: {
        workspaceId: WS_ID,
        namespaceName: "my-namespace",
        tailordbType: {
          name: "invalidLowercaseName",
        },
      },
    } as never);

    await expect(validatePlan(input)).rejects.toThrow(
      /1 validation error\(s\) found in 1 resource\(s\)/,
    );
  });

  test("(b2) TailorDB type with valid name passes", async () => {
    const input = emptyInput();
    input.tailorDB.changeSet.type.creates.push({
      name: "ValidTypeName",
      request: {
        workspaceId: WS_ID,
        namespaceName: "my-namespace",
        tailordbType: {
          name: "ValidTypeName",
        },
      },
    } as never);

    await expect(validatePlan(input)).resolves.toBeUndefined();
  });

  test("(c) workflow create with retryPolicy initialBackoff > maxBackoff is rejected via validatePlan", async () => {
    const input = emptyInput();
    input.workflow.changeSet.creates.push({
      name: "my-workflow",
      workspaceId: WS_ID,
      workflow: {
        name: "my-workflow",
        mainJob: { name: "my-main-job" },
        retryPolicy: {
          maxRetries: 3,
          initialBackoff: "10s",
          maxBackoff: "5s",
          backoffMultiplier: 2.0,
        },
      },
      usedJobNames: ["my-main-job"],
      metaRequest: { trn: "", labels: {} },
    } as never);

    await expect(validatePlan(input)).rejects.toThrow(
      /\d+ validation error\(s\) found in 1 resource\(s\)/,
    );
  });

  test("(d) executor create with invalid name produces a violation", async () => {
    const input = emptyInput();
    input.executor.changeSet.creates.push({
      name: "INVALID_NAME",
      request: {
        workspaceId: WS_ID,
        executor: {
          name: "INVALID_NAME",
        },
      },
    } as never);

    await expect(validatePlan(input)).rejects.toThrow(
      /\d+ validation error\(s\) found in 1 resource\(s\)/,
    );
  });

  test("(f) auth connection create with invalid name is rejected", async () => {
    const input = emptyInput();
    input.auth.changeSet.connection.creates.push({
      name: "INVALID_NAME",
      request: {
        workspaceId: WS_ID,
        connection: {
          name: "INVALID_NAME",
          type: AuthConnection_Type.OAUTH2,
          config: {
            case: "oauth2",
            value: {
              providerUrl: "https://provider.example.com",
              issuerUrl: "https://issuer.example.com",
              clientId: "client123",
              clientSecret: "secret123",
              authUrl: "",
              tokenUrl: "",
            },
          },
        },
      },
      metaRequest: { trn: "", labels: {} },
    } as never);

    await expect(validatePlan(input)).rejects.toThrow(
      /\d+ validation error\(s\) found in 1 resource\(s\)/,
    );
  });

  test("(g) application create with cors containing a placeholder string passes", async () => {
    const input = emptyInput();
    input.app.creates.push({
      name: "my-app",
      request: {
        workspaceId: WS_ID,
        applicationName: "my-app",
        authNamespace: "my-auth",
        cors: ["https://__PLACEHOLDER__"],
        subgraphs: [{ serviceType: 1, serviceNamespace: "tailordb" }],
      },
      metaRequest: { trn: "", labels: {} },
    } as never);

    await expect(validatePlan(input)).resolves.toBeUndefined();
  });

  test("(e) violations from multiple resources are aggregated into one error", async () => {
    const input = emptyInput();

    input.tailorDB.changeSet.type.creates.push({
      name: "firstBad",
      request: {
        workspaceId: WS_ID,
        namespaceName: "my-namespace",
        tailordbType: { name: "firstBad" },
      },
    } as never);

    input.tailorDB.changeSet.type.creates.push({
      name: "secondBad",
      request: {
        workspaceId: WS_ID,
        namespaceName: "my-namespace",
        tailordbType: { name: "secondBad" },
      },
    } as never);

    input.staticWebsite.changeSet.creates.push({
      name: "my-site",
      request: {
        workspaceId: WS_ID,
        staticwebsite: { name: "INVALID_UPPERCASE_SITE" },
      },
    } as never);

    await expect(validatePlan(input)).rejects.toThrow(
      /3 validation error\(s\) found in 3 resource\(s\)/,
    );
  });
});
