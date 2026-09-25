import { idp } from "@tailor-platform/sdk/runtime";

export async function run() {
  const client = new idp.Client({ namespace: "default" });
  return client.listUsers();
}
