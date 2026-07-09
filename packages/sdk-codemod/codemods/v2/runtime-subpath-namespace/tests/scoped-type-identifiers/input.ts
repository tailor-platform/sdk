import type { External } from "./external";
import { Client } from "@tailor-platform/sdk/runtime/idp";

type Wrapper<Client> = {
  value: Client;
  external: External.Client;
  runtime: import("@tailor-platform/sdk/runtime/idp").Client;
};

type RuntimeClient = Client;
