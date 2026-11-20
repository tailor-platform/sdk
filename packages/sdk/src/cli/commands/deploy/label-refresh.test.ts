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

const labelRefresh = { trn: "trn:refresh", labels: { "sdk-name": "my-app" } };
const item = { name: "item", labelRefresh };

const cases: Array<{
  kind: string;
  plan: (results: PlanResults) => void;
  apply: (client: OperatorClient, results: PlanResults) => Promise<unknown>;
}> = [
  {
    kind: "AI gateway",
    plan: (results) => results.aiGateway.changeSet.unchanged.push(item),
    apply: (client, results) => applyAIGateway(client, results.aiGateway, "create-update"),
  },
  {
    kind: "Auth service",
    plan: (results) => results.auth.changeSet.service.unchanged.push(item),
    apply: (client, results) => applyAuth(client, results.auth, "create-update-prerequisites"),
  },
  {
    kind: "Auth connection",
    plan: (results) => results.auth.changeSet.connection.unchanged.push(item),
    apply: (client, results) => applyAuth(client, results.auth, "create-update-dependents"),
  },
  {
    kind: "executor",
    plan: (results) => results.executor.changeSet.unchanged.push(item),
    apply: (client, results) => applyExecutor(client, results.executor, "create-update"),
  },
  {
    kind: "function",
    plan: (results) => results.functionRegistry.changeSet.unchanged.push(item),
    apply: (client, results) =>
      applyFunctionRegistry(client, results.functionRegistry, "create-update"),
  },
  {
    kind: "pipeline service",
    plan: (results) => results.pipeline.changeSet.service.unchanged.push(item),
    apply: (client, results) => applyPipeline(client, results.pipeline, "create-update"),
  },
  {
    kind: "Secret Manager vault",
    plan: (results) => results.secretManager.vaultChangeSet.unchanged.push(item),
    apply: (client, results) => applySecretManager(client, results.secretManager, "create-update"),
  },
  {
    kind: "static website",
    plan: (results) => results.staticWebsite.changeSet.unchanged.push(item),
    apply: (client, results) => applyStaticWebsite(client, results.staticWebsite, "create-update"),
  },
  {
    kind: "custom domain",
    plan: (results) => results.staticWebsite.customDomainChangeSet.unchanged.push(item),
    apply: (client, results) => applyStaticWebsite(client, results.staticWebsite, "create-update"),
  },
  {
    kind: "TailorDB service",
    plan: (results) => results.tailorDB.changeSet.service.unchanged.push(item),
    apply: (client, results) => applyTailorDB(client, results.tailorDB, "create-update"),
  },
  {
    kind: "workflow execution policy",
    plan: (results) => results.workflowExecutionPolicy.changeSet.unchanged.push(item),
    apply: (client, results) =>
      applyWorkflowJobFunctionExecutionPolicy(
        client,
        results.workflowExecutionPolicy,
        "create-update",
      ),
  },
];

describe("label refresh of an unchanged resource", () => {
  test.each(cases)("$kind: create-update rewrites only its labels", async ({ plan, apply }) => {
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
  });
});
