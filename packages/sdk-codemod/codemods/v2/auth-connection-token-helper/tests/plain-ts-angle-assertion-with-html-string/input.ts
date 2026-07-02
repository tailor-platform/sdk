import { auth } from "../tailor.config";

const html = "</div>";

export const token = await (<any>auth).getConnectionToken("google");
