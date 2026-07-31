import {
  other,
} from "../tailor.config";
import { authconnection } from "@tailor-platform/sdk/runtime";

export async function run() {
  return {
    token: await authconnection.getConnectionToken("google"),
    other,
  };
}
