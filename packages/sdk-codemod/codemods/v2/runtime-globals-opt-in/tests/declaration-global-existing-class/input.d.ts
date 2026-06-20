export {};

declare global {
  class TailorErrors extends Error {}
}

type ErrorCtor = typeof TailorErrors;
