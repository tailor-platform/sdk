const { [idp]: keyedValue, x = idp.foo } = opts;

export async function run() {
  const client = new tailor.idp.Client({ namespace: "default" });
  return client.listUsers();
}
