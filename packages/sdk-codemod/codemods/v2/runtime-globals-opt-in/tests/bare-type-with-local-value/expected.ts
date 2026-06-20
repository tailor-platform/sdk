import "@tailor-platform/sdk/runtime/globals";

const TailorErrors = {
  hasError() {
    return false;
  },
};

type ErrorBag = TailorErrors;

export { TailorErrors };
export type { ErrorBag };
