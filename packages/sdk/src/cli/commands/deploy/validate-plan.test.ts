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
    workflowExecutionPolicy: {
      changeSet: createChangeSet("Workflow execution policies"),
      conflicts: [],
      unmanaged: [],
      resourceOwners: new Set(),
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
const METADATA = { trn: "", labels: {} };

type Mutator = (input: ValidatePlanInput) => void;
type Case<Expected> = { name: string; mutate: Mutator; expected: Expected };

const validCases: Case<undefined>[] = [
  {
    name: "(a) empty plan with no creates or updates passes",
    mutate: () => {},
    expected: undefined,
  },
  {
    name: "(b2) TailorDB type with valid name passes",
    mutate: (input) => {
      input.tailorDB.changeSet.type.creates.push({
        name: "ValidTypeName",
        request: {
          workspaceId: WS_ID,
          namespaceName: "my-namespace",
          tailordbType: { name: "ValidTypeName" },
        },
      } as never);
    },
    expected: undefined,
  },
  {
    name: "(g) application create with cors containing a placeholder string passes",
    mutate: (input) => {
      input.app.creates.push({
        name: "my-app",
        request: {
          workspaceId: WS_ID,
          applicationName: "my-app",
          authNamespace: "my-auth",
          cors: ["https://__PLACEHOLDER__"],
          subgraphs: [{ serviceType: 1, serviceNamespace: "tailordb" }],
        },
        metaRequest: METADATA,
      } as never);
    },
    expected: undefined,
  },
  {
    name: "(h2) valid custom domain passes",
    mutate: (input) => {
      input.staticWebsite.customDomainChangeSet.creates.push({
        name: "example.com",
        request: { workspaceId: WS_ID, staticWebsiteName: "my-site", domain: "example.com" },
        metaRequest: METADATA,
      } as never);
    },
    expected: undefined,
  },
  {
    name: "(j2) auth IDP config with valid name and absent config passes",
    mutate: (input) => {
      input.auth.changeSet.idpConfig.creates.push({
        name: "my-idp",
        idpConfig: { kind: "BuiltInIdP" },
        request: { workspaceId: WS_ID, namespaceName: "my-auth", idpConfig: { name: "my-idp" } },
      } as never);
    },
    expected: undefined,
  },
  {
    name: "(k2) workflow job with valid lowercase-hyphen name passes",
    mutate: (input) => {
      input.workflow.changeSet.creates.push({
        name: "my-workflow",
        workspaceId: WS_ID,
        workflow: { name: "my-workflow", mainJob: { name: "my-main-job" } },
        usedJobNames: ["my-main-job"],
        metaRequest: METADATA,
      } as never);
    },
    expected: undefined,
  },
  {
    name: "(l2) IdP client with short names whose derived vault/secret names are valid passes",
    mutate: (input) => {
      input.idp.changeSet.client.creates.push({
        name: "my-client",
        request: { workspaceId: WS_ID, namespaceName: "my-idp", client: { name: "my-client" } },
      } as never);
    },
    expected: undefined,
  },
  {
    name: "(l3) IdP service with allowedReturnOrigins :url placeholder passes",
    mutate: (input) => {
      input.idp.changeSet.service.creates.push({
        name: "my-idp",
        request: {
          workspaceId: WS_ID,
          namespaceName: "my-idp",
          userAuthPolicy: { enableMfa: true, allowedReturnOrigins: ["my-frontend:url"] },
        },
        metaRequest: METADATA,
      } as never);
    },
    expected: undefined,
  },
  {
    name: "(m2) invalid name in unchangedWorkflowJobNames is NOT validated when there are no workflow creates/updates",
    mutate: (input) => {
      input.workflow.unchangedWorkflowJobNames.add("camelCaseJobFromUnchanged");
    },
    expected: undefined,
  },
  {
    name: "(n) workflow execution policy with enableSuffix (registers a trailing `*`) passes",
    mutate: (input) => {
      input.workflowExecutionPolicy.changeSet.creates.push({
        name: "tenant-api",
        workspaceId: WS_ID,
        policy: {
          name: "tenant-api",
          key: "tenant-api",
          enableSuffix: true,
          concurrencyPolicy: { maxConcurrentExecutions: 3 },
        },
        metaRequest: METADATA,
      } as never);
    },
    expected: undefined,
  },
  {
    name: "(n2) workflow execution policy with `:` in key passes",
    mutate: (input) => {
      input.workflowExecutionPolicy.changeSet.creates.push({
        name: "legacy-pipeline",
        workspaceId: WS_ID,
        policy: { name: "legacy-pipeline", key: "legacy:pipeline" },
        metaRequest: METADATA,
      } as never);
    },
    expected: undefined,
  },
];

const invalidCases: Case<RegExp>[] = [
  {
    name: "(b) TailorDB type name violating ^[A-Z][a-zA-Z0-9]{0,62}$ produces a violation",
    mutate: (input) => {
      input.tailorDB.changeSet.type.creates.push({
        name: "invalidLowercaseName",
        request: {
          workspaceId: WS_ID,
          namespaceName: "my-namespace",
          tailordbType: { name: "invalidLowercaseName" },
        },
      } as never);
    },
    expected: /1 validation error\(s\) found in 1 resource\(s\)/,
  },
  {
    name: "(c) workflow create with retryPolicy initialBackoff > maxBackoff is rejected via validatePlan",
    mutate: (input) => {
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
        metaRequest: METADATA,
      } as never);
    },
    expected: /\d+ validation error\(s\) found in 1 resource\(s\)/,
  },
  {
    name: "(d) executor create with invalid name produces a violation",
    mutate: (input) => {
      input.executor.changeSet.creates.push({
        name: "INVALID_NAME",
        request: { workspaceId: WS_ID, executor: { name: "INVALID_NAME" } },
      } as never);
    },
    expected: /\d+ validation error\(s\) found in 1 resource\(s\)/,
  },
  {
    name: "(f) auth connection create with invalid name is rejected",
    mutate: (input) => {
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
        metaRequest: METADATA,
      } as never);
    },
    expected: /\d+ validation error\(s\) found in 1 resource\(s\)/,
  },
  {
    name: "(h) custom domain with invalid name is rejected",
    mutate: (input) => {
      input.staticWebsite.customDomainChangeSet.creates.push({
        name: "INVALID_DOMAIN",
        request: { workspaceId: WS_ID, staticWebsiteName: "my-site", domain: "INVALID_DOMAIN" },
        metaRequest: METADATA,
      } as never);
    },
    expected: /\d+ validation error\(s\) found in 1 resource\(s\)/,
  },
  {
    name: "(i) secret manager vault with invalid name is rejected",
    mutate: (input) => {
      input.secretManager.vaultChangeSet.creates.push({
        name: "INVALID_VAULT",
        workspaceId: WS_ID,
      } as never);
    },
    expected: /\d+ validation error\(s\) found in 1 resource\(s\)/,
  },
  {
    name: "(i2) secret manager secret with invalid name is rejected",
    mutate: (input) => {
      input.secretManager.secretChangeSet.creates.push({
        name: "my-vault/INVALID_SECRET",
        secretName: "INVALID_SECRET",
        workspaceId: WS_ID,
        vaultName: "my-vault",
        value: "my-value",
      } as never);
    },
    expected: /\d+ validation error\(s\) found in 1 resource\(s\)/,
  },
  {
    name: "(j) auth IDP config with invalid name is rejected",
    mutate: (input) => {
      input.auth.changeSet.idpConfig.creates.push({
        name: "INVALID_IDP",
        idpConfig: { kind: "BuiltInIdP" },
        request: {
          workspaceId: WS_ID,
          namespaceName: "my-auth",
          idpConfig: { name: "INVALID_IDP" },
        },
      } as never);
    },
    expected: /\d+ validation error\(s\) found in 1 resource\(s\)/,
  },
  {
    name: "(k) workflow job with camelCase name is rejected",
    mutate: (input) => {
      input.workflow.changeSet.creates.push({
        name: "my-workflow",
        workspaceId: WS_ID,
        workflow: { name: "my-workflow", mainJob: { name: "myMainJob" } },
        usedJobNames: ["myMainJob"],
        metaRequest: METADATA,
      } as never);
    },
    // Both the Workflow (mainJobFunctionName) and the Workflow job function (jobFunctionName)
    // carry the invalid name, so 2 resources fail.
    expected: /\d+ validation error\(s\) found in 2 resource\(s\)/,
  },
  {
    name: "(l) IdP client whose derived secret vault name exceeds 63 chars is rejected",
    mutate: (input) => {
      // namespace "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" (31 chars) + client "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" (31 chars)
      // vault name: "idp-" (4) + 31 + "-" (1) + 31 = 67 chars — exceeds 63
      const namespace = "a".repeat(31);
      const clientName = "b".repeat(31);
      input.idp.changeSet.client.creates.push({
        name: clientName,
        request: { workspaceId: WS_ID, namespaceName: namespace, client: { name: clientName } },
      } as never);
    },
    expected: /validation error/,
  },
  {
    name: "(m) invalid name in unchangedWorkflowJobNames is rejected when a workflow create exists",
    mutate: (input) => {
      input.workflow.changeSet.creates.push({
        name: "my-workflow",
        workspaceId: WS_ID,
        workflow: { name: "my-workflow", mainJob: { name: "my-main-job" } },
        usedJobNames: ["my-main-job"],
        metaRequest: METADATA,
      } as never);
      input.workflow.unchangedWorkflowJobNames.add("camelCaseJobFromUnchanged");
    },
    expected: /validation error/,
  },
  {
    name: "(e) violations from multiple resources are aggregated into one error",
    mutate: (input) => {
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
        request: { workspaceId: WS_ID, staticwebsite: { name: "INVALID_UPPERCASE_SITE" } },
      } as never);
    },
    expected: /3 validation error\(s\) found in 3 resource\(s\)/,
  },
];

describe("validatePlan", () => {
  test.each(validCases)("$name", async ({ mutate }) => {
    const input = emptyInput();
    mutate(input);
    await expect(validatePlan(input)).resolves.toBeUndefined();
  });

  test.each(invalidCases)("$name", async ({ mutate, expected }) => {
    const input = emptyInput();
    mutate(input);
    await expect(validatePlan(input)).rejects.toThrow(expected);
  });
});
