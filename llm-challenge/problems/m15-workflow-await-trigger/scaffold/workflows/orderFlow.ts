// Build the order-processing workflow.
// - Named export `calculateTotal`: WorkflowJob "calculate-total" computing
//   { total } from { quantity, unitPrice }.
// - Named export `processOrder`: WorkflowJob "process-order" that triggers
//   calculateTotal and incorporates its result into { orderId, total }.
// - Default export: createWorkflow({ name: "order-flow", mainJob: processOrder }).
// See problem.md for the full requirements.
