import { auth as googleAuth, defineAuth, auth as githubAuth } from "../tailor.config";

export const googleToken = await googleAuth.getConnectionToken("google");
export const githubToken = await githubAuth.getConnectionToken("github");
export const authConfig = defineAuth();
