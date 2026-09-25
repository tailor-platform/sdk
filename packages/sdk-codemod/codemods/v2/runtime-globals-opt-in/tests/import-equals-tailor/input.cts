import tailor = require("./local-tailor");

export async function run() {
  const client = new tailor.idp.Client({ namespace: "default" });
  return client.listUsers();
}
