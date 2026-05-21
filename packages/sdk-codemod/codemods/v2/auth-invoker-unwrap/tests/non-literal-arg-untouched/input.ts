import { auth } from "../tailor.config";

const machineUserName = "kiosk";

export const cfg = {
  // The argument is not a literal string, so the call is left intact and the
  // `auth` import stays.
  authInvoker: auth.invoker(machineUserName),
};
