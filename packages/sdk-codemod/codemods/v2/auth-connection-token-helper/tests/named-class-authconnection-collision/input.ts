import { auth } from "../tailor.config";

const Local = class authconnection {};

export const token = await auth.getConnectionToken("google");
