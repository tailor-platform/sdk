declare module "pkg" {
  import type { Foo } from "dep";

  export type Wrapped = Foo;
}

const client = new tailor.idp.Client();
