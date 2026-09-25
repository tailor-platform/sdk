import { idp } from "@tailor-platform/sdk/runtime";

declare module "pkg" {
  import { Existing } from "other";

  export interface Thing {
    value: Existing;
  }
}

export const client = new idp.Client({ namespace: "default" });
