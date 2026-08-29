import { afterEach, describe, expect, test, vi } from "vitest";
import { applyDeploymentPlans, type PlannedDeployment } from "./apply-phases";
import { writeMetadataLabels } from "./label";

const mocks = vi.hoisted(() => {
  const calls: string[] = [];
  const state: { onApplicationApply?: (client: unknown) => Promise<void> } = {};
  const marker = (value: unknown) => (value as { marker: string }).marker;
  return {
    calls,
    state,
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
    preflightTailorDB: vi.fn(async (_client, result) => {
      calls.push(`tailordb-preflight:${marker(result)}`);
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
    applyApplication: vi.fn(async (client, result, phase) => {
      calls.push(`application:${marker(result)}:${String(phase)}`);
      if (phase === "create-update") await state.onApplicationApply?.(client);
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

afterEach(() => {
  mocks.state.onApplicationApply = undefined;
});

vi.mock("./secret-manager", () => ({ applySecretManager: mocks.applySecretManager }));
vi.mock("./function-registry", () => ({ applyFunctionRegistry: mocks.applyFunctionRegistry }));
vi.mock("./staticwebsite", () => ({ applyStaticWebsite: mocks.applyStaticWebsite }));
vi.mock("./aigateway", () => ({ applyAIGateway: mocks.applyAIGateway }));
vi.mock("./idp", () => ({ applyIdP: mocks.applyIdP }));
vi.mock("./tailordb", () => ({
  applyTailorDB: mocks.applyTailorDB,
  preflightTailorDB: mocks.preflightTailorDB,
}));
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
  // The documented span tree in docs/telemetry.md drifted from the emitted spans
  // once already, so the names and their nesting are pinned here.
  test("emits a span per apply phase and per service", async () => {
    const { NodeTracerProvider } = await import("@opentelemetry/sdk-trace-node");
    const { InMemorySpanExporter, SimpleSpanProcessor } =
      await import("@opentelemetry/sdk-trace-base");
    const exporter = new InMemorySpanExporter();
    const provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register();

    try {
      await applyDeploymentPlans({} as never, "workspace-id", [deployment("supplier")]);

      const byName = new Map(
        exporter.getFinishedSpans().map((span) => [span.name, span.parentSpanContext?.spanId]),
      );
      const idOf = (name: string) =>
        exporter
          .getFinishedSpans()
          .find((span) => span.name === name)
          ?.spanContext().spanId;

      expect([...byName.keys()].toSorted()).toEqual(
        [
          "apply.cleanup",
          "apply.createUpdateApplication",
          "apply.createUpdateDependentServices",
          "apply.createUpdateServices",
          "apply.deleteApplication",
          "apply.deleteDependentServices",
          "apply.deleteSubgraphResources",
          "apply.deleteSubgraphServices",
          "apply.executor.createUpdate",
          "apply.preflight",
          "apply.aiGateway.createUpdate",
          "apply.auth.createUpdateDependents",
          "apply.auth.createUpdatePrerequisites",
          "apply.functionRegistry.createUpdate",
          "apply.idp.createUpdate",
          "apply.pipeline.createUpdate",
          "apply.secretManager.createUpdate",
          "apply.staticWebsite.createUpdate",
          "apply.tailorDB.createUpdate",
          "apply.workflow.createUpdate",
          "apply.workflowExecutionPolicy.createUpdate",
        ].toSorted(),
      );

      // Per-service spans hang off their phase, so a slow service is attributable.
      expect(byName.get("apply.tailorDB.createUpdate")).toBe(idOf("apply.createUpdateServices"));
      expect(byName.get("apply.executor.createUpdate")).toBe(
        idOf("apply.createUpdateDependentServices"),
      );
    } finally {
      await provider.shutdown();
      const { trace } = await import("@opentelemetry/api");
      trace.disable();
    }
  });

  test("creates TailorDB and IdP for every app before applying Auth or Applications", async () => {
    mocks.calls.length = 0;

    await applyDeploymentPlans({} as never, "workspace-id", [
      deployment("supplier"),
      deployment("buyer"),
    ]);

    expect(mocks.calls).toEqual([
      "tailordb-preflight:supplier-tailordb",
      "tailordb-preflight:buyer-tailordb",
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

  test("fails migration preflight before applying any resource", async () => {
    mocks.calls.length = 0;
    mocks.applySecretManager.mockClear();
    mocks.preflightTailorDB.mockRejectedValueOnce(new Error("migration state changed"));

    await expect(
      applyDeploymentPlans({} as never, "workspace-id", [deployment("supplier")]),
    ).rejects.toThrow("migration state changed");

    expect(mocks.calls).toEqual([]);
    expect(mocks.applySecretManager).not.toHaveBeenCalled();
  });

  test("flushes resource metadata once before dependent delete phases", async () => {
    mocks.calls.length = 0;
    const client = {
      getMetadata: vi.fn().mockResolvedValue({ metadata: { labels: {} } }),
      setMetadata: vi.fn().mockResolvedValue({}),
      bulkSetMetadata: vi.fn().mockImplementation(async () => {
        mocks.calls.push("metadata:bulk");
        return { results: [] };
      }),
    };
    mocks.state.onApplicationApply = async (applyClient) => {
      await writeMetadataLabels(applyClient as never, {
        trn: "trn:v1:workspace:workspace-id:application:supplier",
        labels: { "sdk-name": "supplier" },
      });
    };

    await applyDeploymentPlans(client as never, "workspace-id", [deployment("supplier")]);

    expect(client.setMetadata).not.toHaveBeenCalled();
    expect(client.bulkSetMetadata).toHaveBeenCalledTimes(1);
    expect(mocks.calls.indexOf("metadata:bulk")).toBeGreaterThan(
      mocks.calls.indexOf("workflow:supplier-workflow:create-update"),
    );
    expect(mocks.calls.indexOf("metadata:bulk")).toBeLessThan(
      mocks.calls.indexOf("workflow:supplier-workflow:delete"),
    );
  });

  test("does not start dependent delete phases after a bulk metadata failure", async () => {
    mocks.calls.length = 0;
    const client = {
      getMetadata: vi.fn().mockResolvedValue({ metadata: { labels: {} } }),
      setMetadata: vi.fn().mockResolvedValue({}),
      bulkSetMetadata: vi.fn().mockRejectedValue(new Error("bulk write failed")),
    };
    mocks.state.onApplicationApply = async (applyClient) => {
      await writeMetadataLabels(applyClient as never, {
        trn: "trn:v1:workspace:workspace-id:application:supplier",
        labels: { "sdk-name": "supplier" },
      });
    };

    await expect(
      applyDeploymentPlans(client as never, "workspace-id", [deployment("supplier")]),
    ).rejects.toThrow("bulk write failed");

    expect(mocks.calls).toContain("workflow:supplier-workflow:create-update");
    expect(mocks.calls).not.toContain("workflow:supplier-workflow:delete");
  });
});
