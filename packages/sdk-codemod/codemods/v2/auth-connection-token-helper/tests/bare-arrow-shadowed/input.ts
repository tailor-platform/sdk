import { auth } from "../tailor.config";

export const tokens = ["google"].map(auth => auth.getConnectionToken("google"));
