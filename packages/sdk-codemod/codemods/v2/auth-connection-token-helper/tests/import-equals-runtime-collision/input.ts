import { auth } from "../tailor.config";
import authconnection = require("./client");

export async function run() {
  return auth.getConnectionToken("google");
}
