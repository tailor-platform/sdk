import workflow from "../workflows/order-processing";

const authInvoker = "kiosk";

workflow.trigger(
  { orderId },
  {
  invoker: authInvoker,
  },
);
