export async function run() {
  const client = new tailor.idp.Client(/* namespace required */);
  return client.listUsers();
}
