import cfg, /* note */ { auth } from "../tailor.config";

export const token = await auth.getConnectionToken("google");
export const config = cfg;
