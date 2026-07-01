export async function run(users: unknown[]) {
  for (const idp of users) {
    const client = new tailor.idp.Client({ namespace: "default" });
    return client.listUsers();
  }
}
