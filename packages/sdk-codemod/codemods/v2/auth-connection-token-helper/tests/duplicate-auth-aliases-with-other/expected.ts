import { defineAuth } from "../tailor.config";
import { authconnection } from "@tailor-platform/sdk/runtime";

export const googleToken = await authconnection.getConnectionToken("google");
export const githubToken = await authconnection.getConnectionToken("github");
export const authConfig = defineAuth();
