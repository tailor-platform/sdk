const authInvoker = "kiosk";

workflow.trigger(
  { orderId },
  {
  invoker: authInvoker,
  },
);
