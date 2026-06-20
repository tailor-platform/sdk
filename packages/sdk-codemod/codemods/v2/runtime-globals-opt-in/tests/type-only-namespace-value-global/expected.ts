import "@tailor-platform/sdk/runtime/globals";

declare namespace tailor {
  export type User = string;
}

const Client = tailor.idp.Client;

export { Client };
