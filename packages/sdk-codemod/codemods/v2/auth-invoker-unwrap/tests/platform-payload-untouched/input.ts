import { auth } from "../tailor.config";

tailor.workflow.triggerWorkflow("daily", {}, {
  authInvoker: { namespace, machineUserName },
});

tailor.workflow.triggerWorkflow("daily", {}, {
  authInvoker: auth.invoker("kiosk"),
});

paymentGateway.trigger("charge", {
  authInvoker: "secret",
});

paymentGateway.trigger("charge", {
  authInvoker: "secret",
});
