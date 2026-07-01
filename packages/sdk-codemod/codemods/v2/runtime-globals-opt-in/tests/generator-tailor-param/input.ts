export function* run(tailor: {
  idp: { Client: new (opts: { namespace: string }) => { listUsers(): unknown } };
}) {
  const client = new tailor.idp.Client({ namespace: "default" });
  yield client.listUsers();
}
