import { idp } from "@tailor-platform/sdk/runtime";

type Fn = (tailor: unknown, idp: unknown) => void;

export async function run(_: Fn) {
  const client = new idp.Client({ namespace: "default" });
  return client.listUsers();
}
