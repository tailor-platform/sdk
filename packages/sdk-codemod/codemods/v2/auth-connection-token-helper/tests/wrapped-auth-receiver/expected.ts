import { authconnection } from "@tailor-platform/sdk/runtime";

export const parenthesized = await authconnection.getConnectionToken("google");
export const asserted = await authconnection.getConnectionToken("github");
export const satisfied = await authconnection.getConnectionToken("okta");
export const nonNull = await authconnection.getConnectionToken("microsoft");
export const typeAsserted = await authconnection.getConnectionToken("azure");
