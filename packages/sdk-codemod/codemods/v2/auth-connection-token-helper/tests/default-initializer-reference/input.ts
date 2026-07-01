import { auth } from "../tailor.config";

function read({ x = auth }) {
  return x;
}

export const token = await auth.getConnectionToken("google");
