type Fn = (tailor: unknown, idp: unknown) => void;

export async function run(_: Fn) {
  const client = new tailor.idp.Client({ namespace: "default" });
  return client.listUsers();
}
