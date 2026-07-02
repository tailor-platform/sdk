import { auth } from "../tailor.config";

type authconnection = {
  token: string;
};

export const token = await auth.getConnectionToken("google");
