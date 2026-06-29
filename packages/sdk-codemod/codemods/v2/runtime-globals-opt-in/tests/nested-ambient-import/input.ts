declare module "pkg" {
  import { Existing } from "other";

  export interface Thing {
    value: Existing;
  }
}

export const client = new tailor.idp.Client({ namespace: "default" });
