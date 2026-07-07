import { describe, expect, test, vi } from "vitest";
import { applyDeploymentPlans, type PlannedDeployment } from "./apply-phases";

const mocks = vi.hoisted(() => {
  const calls: string[] = [];
  const marker = (value: unknown) => (value as { marker: string }).marker;
  return {
    calls,
    applySecretManager: vi.fn(async (_client, result, phase) => {
      calls.push(`secret:${marker(result)}:${String(phase)}`);
    }),
    applyFunctionRegistry: vi.fn(async (_client, _workspaceId, result, phase) => {
      calls.push(`function:${marker(result)}:${String(phase)}`);
    }),
    applyStaticWebsite: vi.fn(async (_client, result, phase) => {
      calls.push(`staticwebsite:${marker(result)}:${String(phase)}`);
    }),
    applyAIGateway: vi.fn(async (_client, result, phase) => {
      calls.push(`aigateway:${marker(result)}:${String(phase)}`);
    }),
    applyIdP: vi.fn(async (_client, result, phase) => {
      calls.push(`idp:${marker(result)}:${String(phase)}`);
    }),
    applyTailorDB: vi.fn(async (_client, result, phase) => {
      calls.push(`tailordb:${marker(result)}:${String(phase)}`);
    }),
    applyAuth: vi.fn(async (_client, result, phase) => {
      calls.push(`auth:${marker(result)}:${String(phase)}`);
    }),
    applyPipeline: vi.fn(async (_client, result, phase) => {
      calls.push(`pipeline:${marker(result)}:${String(phase)}`);
    }),
    applyApplication: vi.fn(async (_client, result, phase) => {
      calls.push(`application:${marker(result)}:${String(phase)}`);
    }),
    applyExecutor: vi.fn(async (_client, result, phase) => {
      calls.push(`executor:${marker(result)}:${String(phase)}`);
    }),
    applyWorkflow: vi.fn(async (_client, result, phase) => {
      calls.push(`workflow:${marker(result)}:${String(phase)}`);
    }),
    applyWorkflowJobFunctionExecutionPolicy: vi.fn(async (_client, result, phase) => {
      calls.push(`workflowExecutionPolicy:${marker(result)}:${String(phase)}`);
    }),
  };
});

vi.mock("./secret-manager", () => ({ applySecretManager: mocks.applySecretManager }));
vi.mock("./function-registry", () => ({ applyFunctionRegistry: mocks.applyFunctionRegistry }));
vi.mock("./staticwebsite", () => ({ applyStaticWebsite: mocks.applyStaticWebsite }));
vi.mock("./aigateway", () => ({ applyAIGateway: mocks.applyAIGateway }));
vi.mock("./idp", () => ({ applyIdP: mocks.applyIdP }));
vi.mock("./tailordb", () => ({ applyTailorDB: mocks.applyTailorDB }));
vi.mock("./auth", () => ({ applyAuth: mocks.applyAuth }));
vi.mock("./resolver", () => ({ applyPipeline: mocks.applyPipeline }));
vi.mock("./application", () => ({ applyApplication: mocks.applyApplication }));
vi.mock("./executor", () => ({ applyExecutor: mocks.applyExecutor }));
vi.mock("./workflow", () => ({ applyWorkflow: mocks.applyWorkflow }));
vi.mock("./workflow-execution-policy", () => ({
  applyWorkflowJobFunctionExecutionPolicy: mocks.applyWorkflowJobFunctionExecutionPolicy,
}));

function deployment(name: string): PlannedDeployment {
  const plan = (kind: string) => ({ marker: `${name}-${kind}` });
  return {
    application: { name },
    functionRegistry: plan("function"),
    tailorDB: plan("tailordb"),
    staticWebsite: plan("staticwebsite"),
    aiGateway: plan("aigateway"),
    idp: plan("idp"),
    auth: plan("auth"),
    pipeline: plan("pipeline"),
    app: plan("application"),
    executor: plan("executor"),
    workflow: plan("workflow"),
    workflowExecutionPolicy: plan("workflowExecutionPolicy"),
    secretManager: plan("secret"),
  } as unknown as PlannedDeployment;
}

describe("applyDeploymentPlans", () => {
  test("creates TailorDB and IdP for every app before applying Auth or Applications", async () => {
    mocks.calls.length = 0;

    await applyDeploymentPlans({} as never, "workspace-id", [
      deployment("supplier"),
      deployment("buyer"),
    ]);

    expect(mocks.calls).toEqual([
      "secret:supplier-secret:create-update",
      "secret:buyer-secret:create-update",
      "function:supplier-function:create-update",
      "function:buyer-function:create-update",
      "staticwebsite:supplier-staticwebsite:create-update",
      "staticwebsite:buyer-staticwebsite:create-update",
      "aigateway:supplier-aigateway:create-update",
      "aigateway:buyer-aigateway:create-update",
      "idp:supplier-idp:create-update",
      "idp:buyer-idp:create-update",
      "auth:supplier-auth:create-update-prerequisites",
      "auth:buyer-auth:create-update-prerequisites",
      "tailordb:supplier-tailordb:create-update",
      "tailordb:buyer-tailordb:create-update",
      "auth:supplier-auth:create-update-dependents",
      "auth:buyer-auth:create-update-dependents",
      "pipeline:supplier-pipeline:create-update",
      "pipeline:buyer-pipeline:create-update",
      "pipeline:supplier-pipeline:delete-resources",
      "pipeline:buyer-pipeline:delete-resources",
      "auth:supplier-auth:delete-resources",
      "auth:buyer-auth:delete-resources",
      "idp:supplier-idp:delete-resources",
      "idp:buyer-idp:delete-resources",
      "application:supplier-application:create-update",
      "application:buyer-application:create-update",
      "executor:supplier-executor:create-update",
      "executor:buyer-executor:create-update",
      "workflowExecutionPolicy:supplier-workflowExecutionPolicy:create-update",
      "workflowExecutionPolicy:buyer-workflowExecutionPolicy:create-update",
      "workflow:supplier-workflow:create-update",
      "workflow:buyer-workflow:create-update",
      "workflow:supplier-workflow:delete",
      "workflow:buyer-workflow:delete",
      "workflowExecutionPolicy:supplier-workflowExecutionPolicy:delete",
      "workflowExecutionPolicy:buyer-workflowExecutionPolicy:delete",
      "executor:supplier-executor:delete",
      "executor:buyer-executor:delete",
      "staticwebsite:supplier-staticwebsite:delete",
      "staticwebsite:buyer-staticwebsite:delete",
      "aigateway:supplier-aigateway:delete",
      "aigateway:buyer-aigateway:delete",
      "secret:supplier-secret:delete",
      "secret:buyer-secret:delete",
      "application:supplier-application:delete",
      "application:buyer-application:delete",
      "pipeline:supplier-pipeline:delete-services",
      "pipeline:buyer-pipeline:delete-services",
      "auth:supplier-auth:delete-services",
      "auth:buyer-auth:delete-services",
      "idp:supplier-idp:delete-services",
      "idp:buyer-idp:delete-services",
      "tailordb:supplier-tailordb:delete-services",
      "tailordb:buyer-tailordb:delete-services",
      "function:supplier-function:delete",
      "function:buyer-function:delete",
    ]);
  });
});
