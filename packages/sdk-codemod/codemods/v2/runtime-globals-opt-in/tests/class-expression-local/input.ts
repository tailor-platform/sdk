const RuntimeError = class TailorErrors extends Error {
  value(): TailorErrors {
    return this;
  }
};

export { RuntimeError };
