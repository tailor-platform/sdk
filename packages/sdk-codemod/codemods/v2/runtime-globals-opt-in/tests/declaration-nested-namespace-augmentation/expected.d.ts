/// <reference types="@tailor-platform/sdk/runtime/globals" />

declare namespace tailor {
  namespace idp {
    export type LocalUser = string;
  }
}

type RuntimeUser = tailor.idp.User;
