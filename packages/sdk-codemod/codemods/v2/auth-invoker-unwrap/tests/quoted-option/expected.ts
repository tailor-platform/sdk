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
