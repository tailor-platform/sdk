import { AuthConnection_Type } from "@tailor-platform/tailor-proto/auth_resource_pb";
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

  test("(h) custom domain with invalid name is rejected", async () => {
    const input = emptyInput();
    input.staticWebsite.customDomainChangeSet.creates.push({
      name: "INVALID_DOMAIN",
      request: {
        workspaceId: WS_ID,
        staticWebsiteName: "my-site",
        domain: "INVALID_DOMAIN",
      },
      metaRequest: { trn: "", labels: {} },
    } as never);

    await expect(validatePlan(input)).rejects.toThrow(
      /\d+ validation error\(s\) found in 1 resource\(s\)/,
    );
  });

  test("(h2) valid custom domain passes", async () => {
    const input = emptyInput();
    input.staticWebsite.customDomainChangeSet.creates.push({
      name: "example.com",
      request: {
        workspaceId: WS_ID,
        staticWebsiteName: "my-site",
        domain: "example.com",
      },
      metaRequest: { trn: "", labels: {} },
    } as never);

    await expect(validatePlan(input)).resolves.toBeUndefined();
  });

  test("(i) secret manager vault with invalid name is rejected", async () => {
    const input = emptyInput();
    input.secretManager.vaultChangeSet.creates.push({
      name: "INVALID_VAULT",
      workspaceId: WS_ID,
    } as never);

    await expect(validatePlan(input)).rejects.toThrow(
      /\d+ validation error\(s\) found in 1 resource\(s\)/,
    );
  });

  test("(i2) secret manager secret with invalid name is rejected", async () => {
    const input = emptyInput();
    input.secretManager.secretChangeSet.creates.push({
      name: "my-vault/INVALID_SECRET",
      secretName: "INVALID_SECRET",
      workspaceId: WS_ID,
      vaultName: "my-vault",
      value: "my-value",
    } as never);

    await expect(validatePlan(input)).rejects.toThrow(
      /\d+ validation error\(s\) found in 1 resource\(s\)/,
    );
  });

  test("(j) auth IDP config with invalid name is rejected", async () => {
    const input = emptyInput();
    input.auth.changeSet.idpConfig.creates.push({
      name: "INVALID_IDP",
      idpConfig: { kind: "BuiltInIdP" },
      request: {
        workspaceId: WS_ID,
        namespaceName: "my-auth",
        idpConfig: { name: "INVALID_IDP" },
      },
    } as never);

    await expect(validatePlan(input)).rejects.toThrow(
      /\d+ validation error\(s\) found in 1 resource\(s\)/,
    );
  });

  test("(j2) auth IDP config with valid name and absent config passes", async () => {
    const input = emptyInput();
    input.auth.changeSet.idpConfig.creates.push({
      name: "my-idp",
      idpConfig: { kind: "BuiltInIdP" },
      request: {
        workspaceId: WS_ID,
        namespaceName: "my-auth",
        idpConfig: { name: "my-idp" },
      },
    } as never);

    await expect(validatePlan(input)).resolves.toBeUndefined();
  });

  test("(k) workflow job with camelCase name is rejected", async () => {
    const input = emptyInput();
    input.workflow.changeSet.creates.push({
      name: "my-workflow",
      workspaceId: WS_ID,
      workflow: {
        name: "my-workflow",
        mainJob: { name: "myMainJob" },
      },
      usedJobNames: ["myMainJob"],
      metaRequest: { trn: "", labels: {} },
    } as never);

    // Both the Workflow (mainJobFunctionName) and the Workflow job function (jobFunctionName)
    // carry the invalid name, so 2 resources fail.
    await expect(validatePlan(input)).rejects.toThrow(
      /\d+ validation error\(s\) found in 2 resource\(s\)/,
    );
  });

  test("(k2) workflow job with valid lowercase-hyphen name passes", async () => {
    const input = emptyInput();
    input.workflow.changeSet.creates.push({
      name: "my-workflow",
      workspaceId: WS_ID,
      workflow: {
        name: "my-workflow",
        mainJob: { name: "my-main-job" },
      },
      usedJobNames: ["my-main-job"],
      metaRequest: { trn: "", labels: {} },
    } as never);

    await expect(validatePlan(input)).resolves.toBeUndefined();
  });

  test("(l) IdP client whose derived secret vault name exceeds 63 chars is rejected", async () => {
    const input = emptyInput();
    // namespace "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" (31 chars) + client "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" (31 chars)
    // vault name: "idp-" (4) + 31 + "-" (1) + 31 = 67 chars — exceeds 63
    const namespace = "a".repeat(31);
    const clientName = "b".repeat(31);
    input.idp.changeSet.client.creates.push({
      name: clientName,
      request: {
        workspaceId: WS_ID,
        namespaceName: namespace,
        client: { name: clientName },
      },
    } as never);

    await expect(validatePlan(input)).rejects.toThrow(/validation error/);
  });

  test("(l2) IdP client with short names whose derived vault/secret names are valid passes", async () => {
    const input = emptyInput();
    input.idp.changeSet.client.creates.push({
      name: "my-client",
      request: {
        workspaceId: WS_ID,
        namespaceName: "my-idp",
        client: { name: "my-client" },
      },
    } as never);

    await expect(validatePlan(input)).resolves.toBeUndefined();
  });

  test("(l3) IdP service with allowedReturnOrigins :url placeholder passes", async () => {
    const input = emptyInput();
    input.idp.changeSet.service.creates.push({
      name: "my-idp",
      request: {
        workspaceId: WS_ID,
        namespaceName: "my-idp",
        userAuthPolicy: {
          enableMfa: true,
          allowedReturnOrigins: ["my-frontend:url"],
        },
      },
      metaRequest: { trn: "", labels: {} },
    } as never);

    await expect(validatePlan(input)).resolves.toBeUndefined();
  });

  test("(m) invalid name in unchangedWorkflowJobNames is rejected when a workflow create exists", async () => {
    const input = emptyInput();
    input.workflow.changeSet.creates.push({
      name: "my-workflow",
      workspaceId: WS_ID,
      workflow: {
        name: "my-workflow",
        mainJob: { name: "my-main-job" },
      },
      usedJobNames: ["my-main-job"],
      metaRequest: { trn: "", labels: {} },
    } as never);
    input.workflow.unchangedWorkflowJobNames.add("camelCaseJobFromUnchanged");

    await expect(validatePlan(input)).rejects.toThrow(/validation error/);
  });

  test("(m2) invalid name in unchangedWorkflowJobNames is NOT validated when there are no workflow creates/updates", async () => {
    const input = emptyInput();
    input.workflow.unchangedWorkflowJobNames.add("camelCaseJobFromUnchanged");

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
