import { create } from "@bufbuild/protobuf";
import { durationFromMs } from "@bufbuild/protobuf/wkt";
import { createValidator } from "@bufbuild/protovalidate";
import { CreateWorkflowRequestSchema } from "@tailor-proto/tailor/v1/workflow_pb";
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

  test("(c) message-level CEL rule is evaluated — initial_backoff > max_backoff is rejected", () => {
    const validator = createValidator();
    const req = create(CreateWorkflowRequestSchema, {
      workspaceId: WS_ID,
      workflowName: "my-workflow",
      retryPolicy: {
        maxRetries: 3,
        initialBackoff: durationFromMs(10_000),
        maxBackoff: durationFromMs(5_000),
        backoffMultiplier: 2.0,
      },
    });
    const result = validator.validate(CreateWorkflowRequestSchema, req);
    expect(result.kind).toBe("invalid");
    const violations = result.kind === "invalid" ? result.violations : [];
    const messages = violations.map((v) => v.message);
    expect(messages).toContain("initial_backoff must be less than or equal to max_backoff");
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
