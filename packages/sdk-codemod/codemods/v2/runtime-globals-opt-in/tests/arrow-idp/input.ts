export const run = idp => {
  const client = new tailor.idp.Client({ namespace: "default" });
  return client.listUsers();
};
