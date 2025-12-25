/**
 * Executor Record Change Trigger Performance Test
 *
 * Tests type inference cost for record change trigger executors (create/update/delete)
 * Uses graphql operation (same as other trigger tests) to isolate trigger cost
 */
import {
  createExecutor,
  recordCreatedTrigger,
  recordUpdatedTrigger,
  recordDeletedTrigger,
  db,
} from "../../../src/configure";

const dummyType = db.type("DummyType", { name: db.string() });

export const executor0 = createExecutor({
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

export const executor1 = createExecutor({
  name: "executor1",
  description: "Record updated trigger executor 1",
  trigger: recordUpdatedTrigger({ type: dummyType }),
  operation: {
    kind: "graphql",
    appName: "my-app",
    query: `mutation { log(message: "executed") }`,
    variables: () => ({}),
  },
});

export const executor2 = createExecutor({
  name: "executor2",
  description: "Record deleted trigger executor 2",
  trigger: recordDeletedTrigger({ type: dummyType }),
  operation: {
    kind: "graphql",
    appName: "my-app",
    query: `mutation { log(message: "executed") }`,
    variables: () => ({}),
  },
});

export const executor3 = createExecutor({
  name: "executor3",
  description: "Record created trigger executor 3",
  trigger: recordCreatedTrigger({ type: dummyType }),
  operation: {
    kind: "graphql",
    appName: "my-app",
    query: `mutation { log(message: "executed") }`,
    variables: () => ({}),
  },
});

export const executor4 = createExecutor({
  name: "executor4",
  description: "Record updated trigger executor 4",
  trigger: recordUpdatedTrigger({ type: dummyType }),
  operation: {
    kind: "graphql",
    appName: "my-app",
    query: `mutation { log(message: "executed") }`,
    variables: () => ({}),
  },
});

export const executor5 = createExecutor({
  name: "executor5",
  description: "Record deleted trigger executor 5",
  trigger: recordDeletedTrigger({ type: dummyType }),
  operation: {
    kind: "graphql",
    appName: "my-app",
    query: `mutation { log(message: "executed") }`,
    variables: () => ({}),
  },
});

export const executor6 = createExecutor({
  name: "executor6",
  description: "Record created trigger executor 6",
  trigger: recordCreatedTrigger({ type: dummyType }),
  operation: {
    kind: "graphql",
    appName: "my-app",
    query: `mutation { log(message: "executed") }`,
    variables: () => ({}),
  },
});

export const executor7 = createExecutor({
  name: "executor7",
  description: "Record updated trigger executor 7",
  trigger: recordUpdatedTrigger({ type: dummyType }),
  operation: {
    kind: "graphql",
    appName: "my-app",
    query: `mutation { log(message: "executed") }`,
    variables: () => ({}),
  },
});

export const executor8 = createExecutor({
  name: "executor8",
  description: "Record deleted trigger executor 8",
  trigger: recordDeletedTrigger({ type: dummyType }),
  operation: {
    kind: "graphql",
    appName: "my-app",
    query: `mutation { log(message: "executed") }`,
    variables: () => ({}),
  },
});

export const executor9 = createExecutor({
  name: "executor9",
  description: "Record created trigger executor 9",
  trigger: recordCreatedTrigger({ type: dummyType }),
  operation: {
    kind: "graphql",
    appName: "my-app",
    query: `mutation { log(message: "executed") }`,
    variables: () => ({}),
  },
});
