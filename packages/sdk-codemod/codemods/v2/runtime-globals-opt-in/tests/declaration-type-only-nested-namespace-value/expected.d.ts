/// <reference types="@tailor-platform/sdk/runtime/globals" />

declare namespace tailordb {
  namespace Client {
    export type Extra = string;
  }
}

type ClientCtor = typeof tailordb.Client;
