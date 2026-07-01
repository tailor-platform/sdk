import { auth as googleAuth, auth as githubAuth } from "../tailor.config";

export const googleToken = await googleAuth.getConnectionToken("google");
export const githubToken = await githubAuth.getConnectionToken("github");
