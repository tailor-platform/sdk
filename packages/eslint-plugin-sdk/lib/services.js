export const DEPLOYABLE_SERVICES = new Map([
  ["createResolver", "resolver"],
  ["createExecutor", "executor"],
  ["createHttpAdapter", "HTTP adapter"],
  ["createWorkflow", "workflow"],
]);

export const DEPLOYABLE_SERVICE_FACTORIES = new Set(DEPLOYABLE_SERVICES.keys());
