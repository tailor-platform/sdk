import config, // keep config import
{ auth } from "../tailor.config";

export const configName = config.name;
export const token = await auth.getConnectionToken("google");
