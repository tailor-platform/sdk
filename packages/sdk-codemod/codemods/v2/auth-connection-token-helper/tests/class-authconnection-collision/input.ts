import { auth } from "../tailor.config";

class authconnection {}

export const token = await auth.getConnectionToken("google");
