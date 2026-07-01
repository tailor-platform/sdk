import { client } from "./client";

export async function run() {
  return client.getConnectionToken("google");
}
