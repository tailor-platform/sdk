import { auth } from "../tailor.config";

export const token = await auth.getConnectionToken("google");
export const tokenGetter = auth.getConnectionToken;
