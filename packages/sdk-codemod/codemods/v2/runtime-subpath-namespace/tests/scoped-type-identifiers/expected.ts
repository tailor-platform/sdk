import type { External } from "./external";
import { idp } from "@tailor-platform/sdk/runtime/idp";

type Wrapper<Client> = {
  value: Client;
  external: External.Client;
  runtime: import("@tailor-platform/sdk/runtime/idp").Client;
};

type RuntimeClient = idp.Client;
