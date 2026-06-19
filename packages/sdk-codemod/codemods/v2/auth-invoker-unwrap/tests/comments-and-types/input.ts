export interface Options {
  authInvoker?: string;
}

startWorkflow({
  workflow,
  message: "authInvoker: keep this string",
  // authInvoker: keep this comment
  authInvoker: "kiosk",
});
