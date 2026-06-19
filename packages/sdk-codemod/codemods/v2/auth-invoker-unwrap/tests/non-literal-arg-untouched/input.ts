import { auth } from "../tailor.config";
import workflow from "../workflows/order-processing";

const machineUserName = "kiosk";

workflow.trigger(
  { orderId },
  {
  // The argument is not a literal string, so the call is left intact and the
  // `auth` import stays.
  authInvoker: auth.invoker(machineUserName),
  },
);
