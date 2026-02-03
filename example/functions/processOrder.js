globalThis.main = function (args) {
  console.log("Processing order:", args);
  return { processed: true, orderId: args.orderId };
};
