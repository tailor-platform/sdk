import { idp as runtimeIdp } from "@tailor-platform/sdk/runtime";

const idp = createLocalIdp();

export async function run() {
  const client = new runtimeIdp.Client({ namespace: "default" });
  return client.listUsers(idp);
}
