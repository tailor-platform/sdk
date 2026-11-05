import { describe, expect, test, vi } from "vitest";
import { assertInvokersSurviveDeploy } from "./invoker-validation";
import { dropCrossDeploymentManagedDeletes } from "./managed-resources";
import { emptyPlanResults } from "./test-helpers/plan-results";
import type { OperatorClient } from "#/cli/shared/client";
import type { PlanResults, PlannedDeployment } from "./apply-phases";

function plannedDeployment(name: string, results: PlanResults): PlannedDeployment {
  return { application: { name }, ...results } as unknown as PlannedDeployment;
}

function resultsThatDelete(authNamespace: string) {
  const results = emptyPlanResults();
  results.auth.changeSet.service.deletes.push({ name: authNamespace } as never);
  return results;
}

function resultsReferencing(authNamespace: string) {
  const results = emptyPlanResults();
  results.pipeline.invokerReferences.push({
    namespace: authNamespace,
    machineUserName: "portal",
    context: 'Resolver "ping"',
  });
  return results;
}

type WorkspaceContents = {
  pipelineNamespaces?: string[];
  resolvers?: Record<
    string,
    Array<{ name: string; invoker?: { namespace: string; machineUserName: string } }>
  >;
  executors?: Array<{
    name: string;
    invoker?: { namespace: string; machineUserName: string };
  }>;
};

function workspaceClient(contents: WorkspaceContents = {}) {
  const listPipelineServices = vi.fn().mockResolvedValue({
    pipelineServices: (contents.pipelineNamespaces ?? []).map((name) => ({ namespace: { name } })),
    nextPageToken: "",
  });
  const listPipelineResolvers = vi
    .fn()
    .mockImplementation(({ namespaceName }: { namespaceName: string }) => ({
      pipelineResolvers: (contents.resolvers?.[namespaceName] ?? []).map((resolver) => ({
        name: resolver.name,
        pipelines: [{ invoker: resolver.invoker }],
      })),
      nextPageToken: "",
    }));
  const listExecutorExecutors = vi.fn().mockResolvedValue({
    executors: (contents.executors ?? []).map((executor) => ({
      name: executor.name,
      targetConfig: { config: { case: "function", value: { invoker: executor.invoker } } },
    })),
    nextPageToken: "",
  });
  return {
    client: {
      listPipelineServices,
      listPipelineResolvers,
      listExecutorExecutors,
    } as unknown as OperatorClient,
    listPipelineServices,
    listPipelineResolvers,
    listExecutorExecutors,
  };
}

const oldAuthInvoker = { namespace: "old-auth", machineUserName: "portal" };

function assertDeployments(
  deployments: PlannedDeployment[],
  client: OperatorClient = workspaceClient().client,
) {
  return assertInvokersSurviveDeploy({ client, workspaceId: "ws", deployments });
}

describe("assertInvokersSurviveDeploy", () => {
  describe("invokers of the deploy run", () => {
    test("rejects an invoker whose Auth service another config in the run deletes", async () => {
      await expect(
        assertDeployments([
          plannedDeployment("owner", resultsThatDelete("old-auth")),
          plannedDeployment("portal", resultsReferencing("old-auth")),
        ]),
      ).rejects.toMatchObject({
        code: "INVOKER_MACHINE_USER_NOT_FOUND",
        message: expect.stringContaining('Resolver "ping"'),
        context: expect.objectContaining({ authNamespace: "old-auth", invoker: "portal" }),
      });
    });

    test("rejects an executor invoker whose Auth service the run deletes", async () => {
      const referencing = emptyPlanResults();
      referencing.executor.invokerReferences.push({
        namespace: "old-auth",
        machineUserName: "batch",
        context: 'Executor "nightly"',
      });

      await expect(
        assertDeployments([
          plannedDeployment("owner", resultsThatDelete("old-auth")),
          plannedDeployment("portal", referencing),
        ]),
      ).rejects.toMatchObject({ message: expect.stringContaining('Executor "nightly"') });
    });

    test("accepts an invoker whose Auth service the run keeps", async () => {
      await expect(
        assertDeployments([
          plannedDeployment("owner", resultsThatDelete("other-auth")),
          plannedDeployment("portal", resultsReferencing("old-auth")),
        ]),
      ).resolves.toBeUndefined();
    });

    test("accepts an invoker whose Auth service another config in the run defines again", async () => {
      const previousOwner = resultsThatDelete("old-auth");
      const nextOwner = emptyPlanResults();
      nextOwner.auth.changeSet.service.updates.push({ name: "old-auth" } as never);
      const deployments = [
        plannedDeployment("previous", previousOwner),
        plannedDeployment("next", nextOwner),
        plannedDeployment("portal", resultsReferencing("old-auth")),
      ];

      dropCrossDeploymentManagedDeletes(deployments);

      await expect(assertDeployments(deployments)).resolves.toBeUndefined();
    });
  });

  describe("invokers of apps outside the deploy run", () => {
    test("rejects a resolver of another app that uses the deleted Auth service", async () => {
      const { client } = workspaceClient({
        pipelineNamespaces: ["portal-ns"],
        resolvers: { "portal-ns": [{ name: "ping", invoker: oldAuthInvoker }] },
      });

      await expect(
        assertDeployments([plannedDeployment("owner", resultsThatDelete("old-auth"))], client),
      ).rejects.toMatchObject({
        code: "INVOKER_MACHINE_USER_NOT_FOUND",
        message: expect.stringContaining('Resolver "ping" in pipeline "portal-ns"'),
        context: expect.objectContaining({ authNamespace: "old-auth", invoker: "portal" }),
      });
    });

    test("rejects an executor of another app that uses the deleted Auth service", async () => {
      const { client } = workspaceClient({
        executors: [{ name: "nightly", invoker: oldAuthInvoker }],
      });

      await expect(
        assertDeployments([plannedDeployment("owner", resultsThatDelete("old-auth"))], client),
      ).rejects.toMatchObject({ message: expect.stringContaining('Executor "nightly"') });
    });

    test("does not read the workspace when the run deletes no Auth service", async () => {
      const { client, listPipelineServices, listExecutorExecutors } = workspaceClient();

      await assertDeployments(
        [plannedDeployment("portal", resultsReferencing("old-auth"))],
        client,
      );

      expect(listPipelineServices).not.toHaveBeenCalled();
      expect(listExecutorExecutors).not.toHaveBeenCalled();
    });

    test("accepts a resolver or an executor that uses another Auth service", async () => {
      const { client } = workspaceClient({
        pipelineNamespaces: ["portal-ns"],
        resolvers: {
          "portal-ns": [
            { name: "ping", invoker: { namespace: "kept-auth", machineUserName: "portal" } },
            { name: "open" },
          ],
        },
        executors: [{ name: "nightly", invoker: { namespace: "kept-auth", machineUserName: "b" } }],
      });

      await expect(
        assertDeployments([plannedDeployment("owner", resultsThatDelete("old-auth"))], client),
      ).resolves.toBeUndefined();
    });

    test("leaves the pipelines of the run to the invokers it plans", async () => {
      const owner = resultsThatDelete("old-auth");
      owner.pipeline.changeSet.service.unchanged.push({ name: "owned-ns" });
      const { client, listPipelineResolvers } = workspaceClient({
        pipelineNamespaces: ["owned-ns"],
        resolvers: { "owned-ns": [{ name: "ping", invoker: oldAuthInvoker }] },
      });

      await expect(
        assertDeployments([plannedDeployment("owner", owner)], client),
      ).resolves.toBeUndefined();
      expect(listPipelineResolvers).not.toHaveBeenCalled();
    });

    test("leaves the executors of the run to the invokers it plans", async () => {
      const owner = resultsThatDelete("old-auth");
      owner.executor.changeSet.deletes.push({ name: "nightly", request: {} });
      const { client } = workspaceClient({
        executors: [{ name: "nightly", invoker: oldAuthInvoker }],
      });

      await expect(
        assertDeployments([plannedDeployment("owner", owner)], client),
      ).resolves.toBeUndefined();
    });
  });
});
