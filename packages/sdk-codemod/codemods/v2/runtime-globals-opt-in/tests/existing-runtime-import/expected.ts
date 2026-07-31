import { workflow, idp } from "@tailor-platform/sdk/runtime";

export async function run() {
  await workflow.wait("ready");
  const client = new idp.Client({ namespace: "default" });
  return client.listUsers();
}
