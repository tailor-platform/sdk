export const run = function tailor() {
  const client = new tailor.idp.Client({ namespace: "default" });
  return client.listUsers();
};
