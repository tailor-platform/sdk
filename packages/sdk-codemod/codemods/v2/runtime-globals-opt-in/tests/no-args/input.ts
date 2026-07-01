export async function run() {
  const client = new tailor.idp.Client();
  return client.listUsers();
}
