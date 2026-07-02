import config from "../tailor.config";
import { authconnection } from "@tailor-platform/sdk/runtime";

export const configName = config.name;
export const token = await authconnection.getConnectionToken("google");
