import { workflow, type idp } from "@tailor-platform/sdk/runtime";

export async function run() {
  await workflow.wait("ready");
  const client = new tailor.idp.Client({ namespace: "default" });
  return client.listUsers();
}
