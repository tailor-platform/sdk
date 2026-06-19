import workflow from "../workflows/order-processing";

startWorkflow({
  workflow,
  "authInvoker": "kiosk",
});

workflow.trigger(
  { orderId },
  {
  'authInvoker': "manager",
  },
);
