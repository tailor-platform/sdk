import { describe, expect, test } from "vitest";
import { mockOperatorClient } from "#/cli/shared/test-helpers/operator-client";
import { applyAIGateway } from "./aigateway";
import { applyAuth } from "./auth";
import { applyExecutor } from "./executor";
import { applyFunctionRegistry } from "./function-registry";
import { applyPipeline } from "./resolver";
import { applySecretManager } from "./secret-manager";
import { applyStaticWebsite } from "./staticwebsite";
import { applyTailorDB } from "./tailordb";
import { emptyPlanResults } from "./test-helpers/plan-results";
import { applyWorkflowJobFunctionExecutionPolicy } from "./workflow-execution-policy";
import type { OperatorClient } from "#/cli/shared/client";
import type { PlanResults } from "./apply-phases";
import type { ManagedResourceType } from "./managed-resource-type";

const labelRefresh = { trn: "trn:refresh", labels: { "sdk-name": "my-app" } };
const item = { name: "item", labelRefresh };

type RefreshCase = {
  plan: (results: PlanResults) => void;
  apply: (client: OperatorClient, results: PlanResults) => Promise<unknown>;
};

const WRITES_EVERY_UNCHANGED_ITEM = "its apply writes the labels of every unchanged item";
const NO_SDK_LABELS = "carries no SDK labels";

// Each type either writes the label refresh of an unchanged item, or says why it has none.
const CASES = {
  aigateway: {
    plan: (results) => results.aiGateway.changeSet.unchanged.push(item),
    apply: (client, results) => applyAIGateway(client, results.aiGateway, "create-update"),
  },
  application: WRITES_EVERY_UNCHANGED_ITEM,
  "auth.connection": {
    plan: (results) => results.auth.changeSet.connection.unchanged.push(item),
    apply: (client, results) => applyAuth(client, results.auth, "create-update-dependents"),
  },
  "auth.hook": NO_SDK_LABELS,
  "auth.idp_config": NO_SDK_LABELS,
  "auth.machine_user": NO_SDK_LABELS,
  "auth.oauth2_client": NO_SDK_LABELS,
  "auth.scim": NO_SDK_LABELS,
  "auth.scim_resource": NO_SDK_LABELS,
  "auth.service": {
    plan: (results) => results.auth.changeSet.service.unchanged.push(item),
    apply: (client, results) => applyAuth(client, results.auth, "create-update-prerequisites"),
  },
  "auth.tenant_config": NO_SDK_LABELS,
  "auth.user_profile_config": NO_SDK_LABELS,
  executor: {
    plan: (results) => results.executor.changeSet.unchanged.push(item),
    apply: (client, results) => applyExecutor(client, results.executor, "create-update"),
  },
  function_registry: {
    plan: (results) => results.functionRegistry.changeSet.unchanged.push(item),
    apply: (client, results) =>
      applyFunctionRegistry(client, results.functionRegistry, "create-update"),
  },
  "idp.client": NO_SDK_LABELS,
  "idp.service": WRITES_EVERY_UNCHANGED_ITEM,
  "pipeline.resolver": WRITES_EVERY_UNCHANGED_ITEM,
  "pipeline.service": {
    plan: (results) => results.pipeline.changeSet.service.unchanged.push(item),
    apply: (client, results) => applyPipeline(client, results.pipeline, "create-update"),
  },
  "secret.secret": NO_SDK_LABELS,
  "secret.vault": {
    plan: (results) => results.secretManager.vaultChangeSet.unchanged.push(item),
    apply: (client, results) => applySecretManager(client, results.secretManager, "create-update"),
  },
  staticwebsite: {
    plan: (results) => results.staticWebsite.changeSet.unchanged.push(item),
    apply: (client, results) => applyStaticWebsite(client, results.staticWebsite, "create-update"),
  },
  "staticwebsite.custom_domain": {
    plan: (results) => results.staticWebsite.customDomainChangeSet.unchanged.push(item),
    apply: (client, results) => applyStaticWebsite(client, results.staticWebsite, "create-update"),
  },
  "staticwebsite.custom_domain_transfer": NO_SDK_LABELS,
  "tailordb.gql_permission": NO_SDK_LABELS,
  "tailordb.service": {
    plan: (results) => results.tailorDB.changeSet.service.unchanged.push(item),
    apply: (client, results) => applyTailorDB(client, results.tailorDB, "create-update"),
  },
  "tailordb.type": WRITES_EVERY_UNCHANGED_ITEM,
  workflow: WRITES_EVERY_UNCHANGED_ITEM,
  workflow_job_function: "its labels are written only with its workflow's create or update",
  workflow_job_function_execution_policy: {
    plan: (results) => results.workflowExecutionPolicy.changeSet.unchanged.push(item),
    apply: (client, results) =>
      applyWorkflowJobFunctionExecutionPolicy(
        client,
        results.workflowExecutionPolicy,
        "create-update",
      ),
  },
} satisfies Record<ManagedResourceType, RefreshCase | string>;

const refreshCases = Object.entries(CASES).flatMap(([resourceType, refreshCase]) =>
  typeof refreshCase === "string" ? [] : [{ resourceType, ...refreshCase }],
);

describe("label refresh of an unchanged resource", () => {
  test.each(refreshCases)(
    "$resourceType: create-update rewrites only its labels",
    async ({ plan, apply }) => {
      const results = emptyPlanResults();
      plan(results);
      const client = mockOperatorClient({
        getMetadata: { metadata: { labels: { "sdk-name": "old-name" } } },
        setMetadata: {},
      });

      await apply(client, results);

      expect(client.setMetadata.mock.calls).toEqual([
        [{ trn: "trn:refresh", labels: { "sdk-name": "my-app" } }],
      ]);
    },
  );
});
