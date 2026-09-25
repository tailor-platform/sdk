import { idp as runtimeIdp } from "@tailor-platform/sdk/runtime";

export const run = (runtimeIdp: unknown) => {
  const client = new tailor.idp.Client({ namespace: "default" });
  return client.listUsers();
};
