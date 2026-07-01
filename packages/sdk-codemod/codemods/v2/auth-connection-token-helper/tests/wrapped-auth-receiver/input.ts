import { auth } from "../tailor.config";

export const parenthesized = await (auth).getConnectionToken("google");
export const asserted = await (auth as any).getConnectionToken("github");
export const satisfied = await (auth satisfies unknown).getConnectionToken("okta");
export const nonNull = await auth!.getConnectionToken("microsoft");
export const typeAsserted = await (<any>auth).getConnectionToken("azure");
