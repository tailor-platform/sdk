import cfg from "../tailor.config";
import { authconnection } from "@tailor-platform/sdk/runtime";

export const token = await authconnection.getConnectionToken("google");
export const config = cfg;
