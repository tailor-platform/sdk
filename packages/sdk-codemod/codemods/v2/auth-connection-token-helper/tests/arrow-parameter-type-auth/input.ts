import { auth } from "../tailor.config";

export const run = (input: typeof auth) => auth.getConnectionToken("google");
