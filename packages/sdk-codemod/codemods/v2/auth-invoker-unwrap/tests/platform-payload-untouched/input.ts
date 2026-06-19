import { auth } from "../tailor.config";

tailor.workflow.triggerWorkflow("daily", {}, {
  authInvoker: { namespace, machineUserName },
});

tailor.workflow.triggerWorkflow("daily", {}, {
  authInvoker: auth.invoker("kiosk"),
});
