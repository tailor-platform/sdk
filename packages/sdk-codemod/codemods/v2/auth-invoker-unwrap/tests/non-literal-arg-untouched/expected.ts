import { auth } from "../tailor.config";

const machineUserName = "kiosk";

startWorkflow({
  workflow,
  // The argument is not a literal string, so the call is left intact and the
  // `auth` import stays.
  invoker: auth.invoker(machineUserName),
});
