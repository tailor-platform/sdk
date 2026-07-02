import { auth } from "../tailor.config";

interface authconnection {
  token: string;
}

export const token = await auth.getConnectionToken("google");
