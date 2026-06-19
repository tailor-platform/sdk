import { auth } from "../tailor.config";

const machineUserName = "kiosk";

workflow.trigger(
  { orderId },
  {
  // The argument is not a literal string, so the call is left intact and the
  // `auth` import stays.
  invoker: auth.invoker(machineUserName),
  },
);
