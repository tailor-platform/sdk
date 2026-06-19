import workflow from "../workflows/order-processing";

startWorkflow({
  workflow,
  "invoker": "kiosk",
});

workflow.trigger(
  { orderId },
  {
  'invoker': "manager",
  },
);
