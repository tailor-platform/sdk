export async function run() {
  try {
    return await load();
  } catch ({ idp }) {
    const client = new tailor.idp.Client({ namespace: "default" });
    return client.listUsers();
  }
}
