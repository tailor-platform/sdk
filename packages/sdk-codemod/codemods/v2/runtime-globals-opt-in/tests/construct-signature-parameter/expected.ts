import "@tailor-platform/sdk/runtime/globals";

type Constructor = {
  new (tailor: unknown): unknown;
};

const client = new tailor.idp.Client();

export { client };
export type { Constructor };
