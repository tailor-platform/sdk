import "@tailor-platform/sdk/runtime/globals";

declare module "pkg" {
  import type { Foo } from "dep";

  export type Wrapped = Foo;
}

const client = new tailor.idp.Client();
