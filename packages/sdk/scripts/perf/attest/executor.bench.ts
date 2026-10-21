import { bench } from "@ark/attest";
import type * as sdk from "../../../src/configure";

declare const db: typeof sdk.db;
declare const t: typeof sdk.t;
declare const createExecutor: typeof sdk.createExecutor;
declare const createResolver: typeof sdk.createResolver;
declare const createWorkflow: typeof sdk.createWorkflow;
declare const createWorkflowJob: typeof sdk.createWorkflowJob;
declare const incomingWebhookTrigger: typeof sdk.incomingWebhookTrigger;
declare const recordCreatedTrigger: typeof sdk.recordCreatedTrigger;
declare const resolverExecutedTrigger: typeof sdk.resolverExecutedTrigger;
declare const scheduleTrigger: typeof sdk.scheduleTrigger;

const defineDummyType = () => db.table("DummyType", { name: db.string() });
declare const dummyType: ReturnType<typeof defineDummyType>;

const defineDummyResolver = () =>
  createResolver({
    name: "dummyResolver",
    operation: "query",
    input: { id: t.string() },
    body: async (context) => ({ id: context.input.id, name: "dummy" }),
    output: t.object({ id: t.string(), name: t.string() }),
  });
declare const dummyResolver: ReturnType<typeof defineDummyResolver>;

const defineDummyWorkflow = () =>
  createWorkflow({
    name: "dummyWorkflow",
    mainJob: createWorkflowJob({
      name: "mainJob",
      body: (input: { id: string }) => {
        console.log("Processing", input.id);
        return { processed: true };
      },
    }),
  });
declare const dummyWorkflow: ReturnType<typeof defineDummyWorkflow>;

bench.baseline(() =>
  createExecutor({
    name: "baseline",
    description: "Baseline executor",
    trigger: incomingWebhookTrigger(),
    operation: {
      kind: "function",
      body: async () => {
        console.log("Baseline executed");
      },
    },
  }),
);

bench("executor-schedule", () => {
  return createExecutor({
    name: "executor0",
    description: "Scheduled executor 0",
    trigger: scheduleTrigger({ cron: "0 0 * * *" }),
    operation: {
      kind: "graphql",
      appName: "my-app",
      query: `mutation { log(message: "executed") }`,
      variables: () => ({}),
    },
  });
}).types([1388, "instantiations"]);

bench("executor-webhook", () => {
  return createExecutor({
    name: "executor0",
    description: "Webhook executor 0",
    trigger: incomingWebhookTrigger(),
    operation: {
      kind: "graphql",
      appName: "my-app",
      query: `mutation { process(data: $data) }`,
      variables: () => ({ data: "webhook-data" }),
    },
  });
}).types([47, "instantiations"]);

bench("executor-record", () => {
  return createExecutor({
    name: "executor0",
    description: "Record created trigger executor 0",
    trigger: recordCreatedTrigger({ type: dummyType }),
    operation: {
      kind: "graphql",
      appName: "my-app",
      query: `mutation { log(message: "executed") }`,
      variables: () => ({}),
    },
  });
}).types([3219, "instantiations"]);

bench("executor-resolver", () => {
  return createExecutor({
    name: "executor0",
    description: "Resolver executed trigger executor 0",
    trigger: resolverExecutedTrigger({ resolver: dummyResolver }),
    operation: {
      kind: "graphql",
      appName: "my-app",
      query: `mutation { log(message: "executed") }`,
      variables: () => ({}),
    },
  });
}).types([463, "instantiations"]);

bench("executor-operation-function", () => {
  return createExecutor({
    name: "executor0",
    description: "Function operation executor 0",
    trigger: incomingWebhookTrigger(),
    operation: {
      kind: "function",
      body: async () => {
        console.log("Function executed 0");
      },
    },
  });
}).types([30, "instantiations"]);

bench("executor-operation-gql", () => {
  const query = `
    query GetUser($id: ID!) {
      user(id: $id) {
        id
        name
      }
    }
  `;

  return createExecutor({
    name: "executor0",
    description: "GQL operation executor 0",
    trigger: incomingWebhookTrigger(),
    operation: {
      kind: "graphql",
      query,
      variables: () => ({ id: "1" }),
    },
  });
}).types([43, "instantiations"]);

bench("executor-operation-webhook", () => {
  return createExecutor({
    name: "executor0",
    description: "Webhook operation executor 0",
    trigger: incomingWebhookTrigger(),
    operation: {
      kind: "webhook",
      url: () => "https://api.example.com/webhook/0",
      requestBody: () => ({ data: "test" }),
      headers: {
        "Content-Type": "application/json",
        Authorization: { vault: "secrets", key: "api-key" },
      },
    },
  });
}).types([50, "instantiations"]);

bench("executor-operation-workflow", () => {
  return createExecutor({
    name: "executor0",
    description: "Workflow operation executor 0",
    trigger: incomingWebhookTrigger(),
    operation: {
      kind: "workflow",
      workflow: dummyWorkflow,
      args: { id: "0" },
    },
  });
}).types([211, "instantiations"]);
