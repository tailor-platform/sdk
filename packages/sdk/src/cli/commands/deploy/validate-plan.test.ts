import {
  AuthConnection_Type,
  AuthOAuth2Client_ClientType,
  AuthOAuth2Client_GrantType,
} from "@tailor-platform/tailor-proto/auth_resource_pb";
import { TailorDBGQLPermission_Permit } from "@tailor-platform/tailor-proto/tailordb_resource_pb";
import { describe, expect, test, vi } from "vitest";
import { logger, plainRedacted } from "#/cli/shared/logger";
import { MANAGED_RESOURCES } from "./managed-resources";
import { emptyPlanResults, PLANNED_ITEM } from "./test-helpers/plan-results";
import { REQUEST_CHECKS, validatePlans } from "./validate-plan";
import type { PlanResults } from "./apply-phases";
import type { ManagedResourceType } from "./managed-resource-type";

const WS_ID = "00000000-0000-0000-0000-000000000001";
const METADATA = { trn: "", labels: {} };

type Mutator = (input: PlanResults) => void;
type Case<Expected> = { name: string; mutate: Mutator; expected: Expected };

function invalidTableName(input: PlanResults): void {
  input.tailorDB.changeSet.type.creates.push({
    name: "invalidLowercaseName",
    request: {
      workspaceId: WS_ID,
      namespaceName: "my-namespace",
      tailordbType: { name: "invalidLowercaseName" },
    },
  } as never);
}

const INVALID_CONNECTION = {
  name: "INVALID_NAME",
  type: AuthConnection_Type.OAUTH2,
  config: {
    case: "oauth2" as const,
    value: {
      providerUrl: "https://provider.example.com",
      issuerUrl: "https://issuer.example.com",
      clientId: "client123",
      clientSecret: "secret123",
      authUrl: "",
      tokenUrl: "",
    },
  },
};

function invalidConnectionUpdate(input: PlanResults): void {
  input.auth.changeSet.connection.updates.push({
    name: INVALID_CONNECTION.name,
    request: {
      workspaceId: WS_ID,
      connection: INVALID_CONNECTION,
      updateMask: { paths: ["oauth2.token_url"] },
    },
    metaRequest: METADATA,
  });
}

function invalidRetryPolicy(input: PlanResults): void {
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
}

const validCases: Case<undefined>[] = [
  {
    name: "(a) empty plan with no creates or updates passes",
    mutate: () => {},
    expected: undefined,
  },
  {
    name: "(b2) TailorDB table with valid name passes",
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
      });
    },
    expected: undefined,
  },
  {
    name: "(g2) AIGateway create with cors containing a placeholder string passes",
    mutate: (input) => {
      input.aiGateway.changeSet.creates.push({
        name: "my-gateway",
        request: {
          workspaceId: WS_ID,
          aigatewayName: "my-gateway",
          authNamespace: "my-auth",
          cors: ["my-frontend:url"],
        },
        metaRequest: METADATA,
      });
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
      });
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
      });
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
          userAuthPolicy: {
            allowedEmailDomains: ["*"],
            enableMfa: true,
            allowedReturnOrigins: ["my-frontend:url"],
          },
        },
        metaRequest: METADATA,
      });
    },
    expected: undefined,
  },
  {
    name: "(l5) IdP service with a non-email identifier and no allowedEmailDomains passes",
    mutate: (input) => {
      input.idp.changeSet.service.creates.push({
        name: "my-idp",
        request: {
          workspaceId: WS_ID,
          namespaceName: "my-idp",
          userAuthPolicy: { useNonEmailIdentifier: true },
        },
        metaRequest: METADATA,
      });
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
    name: "(n) workflow execution policy with matchType: 'prefix' (registers a trailing `*`) passes",
    mutate: (input) => {
      input.workflowExecutionPolicy.changeSet.creates.push({
        name: "tenant-api",
        workspaceId: WS_ID,
        policy: {
          name: "tenant-api",
          // Deliberately different from `name` (and using `_`, which `name`'s
          // grammar disallows) to show `key` is validated independently.
          key: "tenant_api",
          matchType: "prefix",
          concurrencyPolicy: { maxConcurrentExecutions: 3 },
        },
        metaRequest: METADATA,
      } as never);
    },
    expected: undefined,
  },
  {
    name: "(o) OAuth2 client with clientType public and requireDpop passes",
    mutate: (input) => {
      input.auth.changeSet.oauth2Client.creates.push({
        name: "default",
        request: {
          workspaceId: WS_ID,
          namespaceName: "my-auth",
          oauth2Client: {
            name: "default",
            clientType: AuthOAuth2Client_ClientType.PUBLIC,
            requireDpop: true,
            grantTypes: [AuthOAuth2Client_GrantType.AUTHORIZATION_CODE],
            redirectUris: ["https://example.com/callback"],
          },
        },
      });
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
  {
    name: "(f2) auth connection update that only writes labels passes",
    mutate: (input) => {
      input.auth.changeSet.connection.updates.push({
        name: "adopted-connection",
        metaRequest: METADATA,
      });
    },
    expected: undefined,
  },
];

const invalidCases: Case<RegExp>[] = [
  {
    name: "(b) TailorDB table name violating ^[A-Z][a-zA-Z0-9]{0,62}$ produces a violation",
    mutate: invalidTableName,
    expected: /1 validation error\(s\) found in 1 resource\(s\)/,
  },
  {
    name: "(c) workflow create with retryPolicy initialBackoff > maxBackoff is rejected",
    mutate: invalidRetryPolicy,
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
    name: "(d2) AIGateway create with invalid name produces a violation",
    mutate: (input) => {
      input.aiGateway.changeSet.creates.push({
        name: "INVALID_NAME",
        request: {
          workspaceId: WS_ID,
          aigatewayName: "INVALID_NAME",
          authNamespace: "my-auth",
          cors: [],
        },
        metaRequest: METADATA,
      });
    },
    expected: /\d+ validation error\(s\) found in 1 resource\(s\)/,
  },
  {
    name: "(f) auth connection create with invalid name is rejected",
    mutate: (input) => {
      input.auth.changeSet.connection.creates.push({
        name: INVALID_CONNECTION.name,
        request: { workspaceId: WS_ID, connection: INVALID_CONNECTION },
        metaRequest: METADATA,
      });
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
      });
    },
    expected: /\d+ validation error\(s\) found in 1 resource\(s\)/,
  },
  {
    name: "(i) secret manager vault with invalid name is rejected",
    mutate: (input) => {
      input.secretManager.vaultChangeSet.creates.push({
        name: "INVALID_VAULT",
        workspaceId: WS_ID,
      });
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
      });
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
      });
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
    name: "(o2) OAuth2 client with clientType browser and requireDpop is rejected",
    mutate: (input) => {
      input.auth.changeSet.oauth2Client.creates.push({
        name: "default",
        request: {
          workspaceId: WS_ID,
          namespaceName: "my-auth",
          oauth2Client: {
            name: "default",
            clientType: AuthOAuth2Client_ClientType.BROWSER,
            requireDpop: true,
            grantTypes: [AuthOAuth2Client_GrantType.AUTHORIZATION_CODE],
            redirectUris: ["https://example.com/callback"],
          },
        },
      });
    },
    expected: /1 validation error\(s\) found in 1 resource\(s\)/,
  },
  {
    name: "(o3) OAuth2 client with a refresh token lifetime above 7 days and no idle lifetime is rejected",
    mutate: (input) => {
      input.auth.changeSet.oauth2Client.updates.push({
        name: "default",
        request: {
          workspaceId: WS_ID,
          namespaceName: "my-auth",
          oauth2Client: {
            name: "default",
            clientType: AuthOAuth2Client_ClientType.PUBLIC,
            grantTypes: [AuthOAuth2Client_GrantType.AUTHORIZATION_CODE],
            redirectUris: ["https://example.com/callback"],
            refreshTokenLifetime: { seconds: 604801n },
          },
        },
      });
    },
    expected: /1 validation error\(s\) found in 1 resource\(s\)/,
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
  {
    name: "(l4) IdP service with allowedReturnOrigins :url placeholder using an invalid slug is rejected",
    mutate: (input) => {
      input.idp.changeSet.service.creates.push({
        name: "my-idp",
        request: {
          workspaceId: WS_ID,
          namespaceName: "my-idp",
          userAuthPolicy: {
            allowedEmailDomains: ["*"],
            enableMfa: true,
            allowedReturnOrigins: ["My_Frontend:url"],
          },
        },
        metaRequest: METADATA,
      });
    },
    expected: /1 validation error\(s\) found in 1 resource\(s\)/,
  },
  {
    name: "(l6) IdP service create with an empty allowedEmailDomains is rejected once",
    mutate: (input) => {
      input.idp.changeSet.service.creates.push({
        name: "my-idp",
        request: {
          workspaceId: WS_ID,
          namespaceName: "my-idp",
          userAuthPolicy: { allowedEmailDomains: [] },
        },
        metaRequest: METADATA,
      });
    },
    expected: /1 validation error\(s\) found in 1 resource\(s\)/,
  },
  {
    name: "(l7) IdP service update with an empty allowedEmailDomains is rejected",
    mutate: (input) => {
      input.idp.changeSet.service.updates.push({
        name: "my-idp",
        request: {
          workspaceId: WS_ID,
          namespaceName: "my-idp",
          userAuthPolicy: { allowedEmailDomains: [] },
        },
        metaRequest: METADATA,
      });
    },
    expected: /1 validation error\(s\) found in 1 resource\(s\)/,
  },
  {
    name: "(p) TailorDB GraphQL permission whose policy lists no actions is rejected",
    mutate: (input) => {
      input.tailorDB.changeSet.gqlPermission.creates.push({
        name: "Item",
        request: {
          workspaceId: WS_ID,
          namespaceName: "main",
          typeName: "Item",
          permission: {
            policies: [{ actions: [], permit: TailorDBGQLPermission_Permit.ALLOW }],
          },
        },
      });
    },
    expected: /1 validation error\(s\) found in 1 resource\(s\)/,
  },
  {
    name: "(q) function whose script exceeds the 20 MiB upload limit is rejected",
    mutate: (input) => {
      input.functionRegistry.changeSet.updates.push({
        name: "resolver--main--big",
        workspaceId: WS_ID,
        entry: {
          name: "resolver--main--big",
          scriptContent: "x".repeat(20 * 1024 * 1024 + 1),
          contentHash: "0".repeat(64),
          description: "",
        },
        metaRequest: METADATA,
      });
    },
    expected: /1 validation error\(s\) found in 1 resource\(s\)/,
  },
  {
    name: "(l8) IdP service create whose userAuthPolicy omits allowedEmailDomains is rejected",
    mutate: (input) => {
      input.idp.changeSet.service.creates.push({
        name: "my-idp",
        request: {
          workspaceId: WS_ID,
          namespaceName: "my-idp",
          userAuthPolicy: { passwordMinLength: 8 },
        },
        metaRequest: METADATA,
      });
    },
    expected: /1 validation error\(s\) found in 1 resource\(s\)/,
  },
];

const LIST_ACTIONS = {
  creates: "create",
  updates: "update",
  replaces: "replace",
  unchanged: "update",
} as const;

type CheckedList = keyof typeof LIST_ACTIONS;

/** Every field a request check reads, with a workspace ID that is not a UUID. */
const ITEM_OF_ANY_LIST = {
  ...PLANNED_ITEM,
  request: { workspaceId: PLANNED_ITEM.workspaceId },
  createRequest: { workspaceId: PLANNED_ITEM.workspaceId },
  metaRequest: METADATA,
  namespaceName: "main",
  vaultName: "vault",
  secretName: "secret",
  value: "value",
  workflow: { name: "workflow", mainJob: { name: "job" } },
  usedJobNames: ["job"],
  policy: { name: "policy", key: "policy" },
  entry: {
    name: "function",
    scriptContent: "// script",
    contentHash: "0".repeat(64),
    description: "",
  },
};

function planItem(results: PlanResults, resourceType: ManagedResourceType, list: CheckedList) {
  if (resourceType !== "workflow_job_function") {
    (MANAGED_RESOURCES[resourceType].changeSetOf(results)[list] as unknown[]).push(
      ITEM_OF_ANY_LIST,
    );
    return;
  }
  // Job functions are listed from the workflows that use them.
  const workflows = results.workflow.changeSet;
  const usedJobNames = list === "unchanged" ? [] : ITEM_OF_ANY_LIST.usedJobNames;
  (list === "updates" ? workflows.updates : workflows.creates).push({
    ...ITEM_OF_ANY_LIST,
    usedJobNames,
  } as never);
  if (list === "unchanged") {
    results.workflow.unchangedWorkflowJobNames.add("job");
  }
}

const CHECKED_LISTS = Object.entries(REQUEST_CHECKS).flatMap(([resourceType, checks]) =>
  (Object.keys(LIST_ACTIONS) as CheckedList[]).flatMap((list) => {
    const listChecks: ReadonlyArray<{ action?: string }> =
      (checks as Partial<Record<CheckedList, ReadonlyArray<{ action?: string }>>>)[list] ?? [];
    const actions = [...new Set(listChecks.map((check) => check.action ?? LIST_ACTIONS[list]))];
    return actions.map((action) => ({
      resourceType: resourceType as ManagedResourceType,
      list,
      action,
    }));
  }),
);

describe("validatePlans", () => {
  test.each(CHECKED_LISTS)(
    "validates each $resourceType in $list as a $action",
    async ({ resourceType, list, action }) => {
      using _errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
      using _logSpy = vi.spyOn(logger, "log").mockImplementation(() => {});
      const results = emptyPlanResults();
      planItem(results, resourceType, list);

      const error = await validatePlans([{ application: "my-app", results }]).catch(
        (e: unknown) => e,
      );

      expect(error).toMatchObject({
        code: "DEPLOY_VALIDATION_FAILED",
        context: {
          issues: expect.arrayContaining([
            expect.objectContaining({
              resourceType,
              action,
              fieldPath: expect.stringMatching(/(^|\.)workspace_id$/),
            }),
          ]),
        },
      });
    },
  );

  test.each(validCases)("$name", async ({ mutate }) => {
    const input = emptyPlanResults();
    mutate(input);
    await expect(
      validatePlans([{ application: "my-app", results: input }]),
    ).resolves.toBeUndefined();
  });

  test.each(invalidCases)("$name", async ({ mutate, expected }) => {
    const input = emptyPlanResults();
    mutate(input);
    await expect(validatePlans([{ application: "my-app", results: input }])).rejects.toThrow(
      expected,
    );
  });

  test("names the IdP services that leave allowedEmailDomains empty and how each is applied", async () => {
    using _errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    using logSpy = vi.spyOn(logger, "log").mockImplementation(() => {});
    const input = emptyPlanResults();
    input.idp.changeSet.service.creates.push({
      name: "new-idp",
      request: { workspaceId: WS_ID, namespaceName: "new-idp" },
      metaRequest: METADATA,
    });
    input.idp.changeSet.service.updates.push({
      name: "existing-idp",
      request: { workspaceId: WS_ID, namespaceName: "existing-idp" },
      metaRequest: METADATA,
    });
    input.idp.changeSet.service.unchanged.push({ name: "unchanged-idp" });

    const error = await validatePlans([{ application: "my-app", results: input }]).catch(
      (error: unknown) => error,
    );
    expect(error).toMatchObject({
      code: "DEPLOY_VALIDATION_FAILED",
      message: "2 validation error(s) found in 2 resource(s)",
      context: {
        issues: [
          {
            application: "my-app",
            resourceType: "idp.service",
            name: "new-idp",
            action: "create",
            fieldPath: "userAuthPolicy.allowedEmailDomains",
          },
          {
            application: "my-app",
            resourceType: "idp.service",
            name: "existing-idp",
            action: "update",
            fieldPath: "userAuthPolicy.allowedEmailDomains",
          },
        ],
      },
    });

    const reason =
      'userAuthPolicy.allowedEmailDomains: must be set unless useNonEmailIdentifier is true; use ["*"] to allow every email domain, or list the domains you accept';
    expect(logSpy.mock.calls.map(([line]) => plainRedacted(line).trim())).toEqual([
      `IdP service new-idp (create) — ${reason}`,
      `IdP service existing-idp (update) — ${reason}`,
    ]);
  });

  test.each([
    ["without token lifetimes", {}],
    [
      "with the longest refresh token lifetimes",
      {
        accessTokenLifetime: { seconds: 900n },
        refreshTokenLifetime: { seconds: 7776000n },
        refreshTokenIdleLifetime: { seconds: 2592000n },
      },
    ],
  ])(
    "evaluates message-level CEL rules %s instead of warning that they could not run",
    async (_label, lifetimes) => {
      using warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const input = emptyPlanResults();
      const request = {
        workspaceId: WS_ID,
        namespaceName: "my-auth",
        oauth2Client: {
          name: "default",
          clientType: AuthOAuth2Client_ClientType.PUBLIC,
          requireDpop: true,
          grantTypes: [AuthOAuth2Client_GrantType.AUTHORIZATION_CODE],
          redirectUris: ["https://example.com/callback"],
          ...lifetimes,
        },
      };
      input.auth.changeSet.oauth2Client.creates.push({ name: "default", request });
      input.auth.changeSet.oauth2Client.updates.push({ name: "default", request });

      await expect(
        validatePlans([{ application: "my-app", results: input }]),
      ).resolves.toBeUndefined();
      expect(warnSpy).not.toHaveBeenCalled();
    },
  );

  test.each(validCases)("$name does not warn that a rule could not run", async ({ mutate }) => {
    using warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const input = emptyPlanResults();
    mutate(input);

    await validatePlans([{ application: "my-app", results: input }]);

    expect(warnSpy).not.toHaveBeenCalled();
  });

  test.each([
    {
      name: "a TailorDB type create",
      mutate: invalidTableName,
      issue: {
        resourceType: "tailordb.type",
        name: "invalidLowercaseName",
        action: "create",
        fieldPath: "tailordb_type.name",
      },
    },
    {
      name: "an auth connection update",
      mutate: invalidConnectionUpdate,
      issue: {
        resourceType: "auth.connection",
        name: INVALID_CONNECTION.name,
        action: "update",
        fieldPath: "connection.name",
      },
    },
  ])("carries each violation of $name in the error context", async ({ mutate, issue }) => {
    using _errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    using logSpy = vi.spyOn(logger, "log").mockImplementation(() => {});
    const input = emptyPlanResults();
    mutate(input);

    const error = await validatePlans([{ application: "my-app", results: input }]).catch(
      (e: unknown) => e,
    );

    expect(error).toMatchObject({
      code: "DEPLOY_VALIDATION_FAILED",
      context: {
        issues: [{ application: "my-app", ...issue, message: expect.any(String) }],
      },
    });
    expect(logSpy.mock.calls.flat().join("\n")).not.toContain("my-app");
  });

  test.each([
    {
      label: "TailorDB namespace",
      mutate: (input: PlanResults) =>
        input.tailorDB.changeSet.service.creates.push({
          name: "main",
          request: { workspaceId: "not-a-uuid", namespaceName: "main" },
        } as never),
    },
    {
      label: "Resolver namespace",
      mutate: (input: PlanResults) =>
        input.pipeline.changeSet.service.creates.push({
          name: "main",
          request: { workspaceId: "not-a-uuid", namespaceName: "main" },
        } as never),
    },
    {
      label: "Auth IdP config",
      mutate: (input: PlanResults) =>
        input.auth.changeSet.idpConfig.creates.push({
          name: "main",
          request: { workspaceId: "not-a-uuid", namespaceName: "main-auth" },
        } as never),
    },
    {
      label: "IdP client secret",
      mutate: (input: PlanResults) =>
        input.idp.changeSet.client.creates.push({
          name: "main",
          request: { workspaceId: WS_ID, namespaceName: "a".repeat(60), client: { name: "main" } },
        }),
    },
  ])("names a violation by the resource label $label", async ({ label, mutate }) => {
    using _errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    using logSpy = vi.spyOn(logger, "log").mockImplementation(() => {});
    const input = emptyPlanResults();
    mutate(input);

    await expect(validatePlans([{ application: "my-app", results: input }])).rejects.toThrow(
      /validation error/,
    );

    expect(logSpy.mock.calls.map(([line]) => plainRedacted(line))).toContainEqual(
      expect.stringMatching(new RegExp(`^ {2}${label} main \\(create\\) — `)),
    );
  });

  test("reports the violations of every plan in one error", async () => {
    using _errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    using logSpy = vi.spyOn(logger, "log").mockImplementation(() => {});
    const first = emptyPlanResults();
    invalidTableName(first);
    const second = emptyPlanResults();
    invalidTableName(second);

    const error = await validatePlans([
      { application: "app-a", results: first },
      { application: "app-b", results: second },
    ]).catch((e: unknown) => e);

    expect(error).toMatchObject({
      message: "2 validation error(s) found in 2 resource(s)",
      context: {
        issues: [
          { application: "app-a", name: "invalidLowercaseName" },
          { application: "app-b", name: "invalidLowercaseName" },
        ],
      },
    });
    expect(logSpy.mock.calls.map(([line]) => plainRedacted(line))).toEqual([
      '  Application "app-a":',
      expect.stringMatching(
        /^ {4}TailorDB table invalidLowercaseName \(create\) — tailordb_type\.name: /,
      ),
      '  Application "app-b":',
      expect.stringMatching(
        /^ {4}TailorDB table invalidLowercaseName \(create\) — tailordb_type\.name: /,
      ),
    ]);
  });
});
