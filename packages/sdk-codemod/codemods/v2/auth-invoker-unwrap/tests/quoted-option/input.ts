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
