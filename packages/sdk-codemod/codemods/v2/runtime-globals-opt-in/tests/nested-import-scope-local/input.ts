declare module "pkg" {
  import { tailor } from "dep";
  export type Local = typeof tailor;
}

export {};
