import { auth } from "../tailor.config";
import { authconnection } from "@tailor-platform/sdk/runtime";

function read({ x = auth }) {
  return x;
}

export const token = await authconnection.getConnectionToken("google");
