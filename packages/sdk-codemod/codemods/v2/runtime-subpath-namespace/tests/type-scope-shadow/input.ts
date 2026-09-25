import { Client } from "@tailor-platform/sdk/runtime/idp";

type Wrapper<Client> = Client;
type Unwrap<T> = T extends Promise<infer Client> ? Client : never;
type MapClient<Keys extends string> = { [Client in Keys]: Client };

const client = new Client({ namespace: "default" });
