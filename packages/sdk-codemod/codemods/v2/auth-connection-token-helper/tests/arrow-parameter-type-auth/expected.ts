import { auth } from "../tailor.config";
import { authconnection } from "@tailor-platform/sdk/runtime";

export const run = (input: typeof auth) => authconnection.getConnectionToken("google");
