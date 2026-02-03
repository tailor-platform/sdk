globalThis.main = function (args) {
  return {
    message: `Hello, ${args.input?.name || "World"}!`,
  };
};
