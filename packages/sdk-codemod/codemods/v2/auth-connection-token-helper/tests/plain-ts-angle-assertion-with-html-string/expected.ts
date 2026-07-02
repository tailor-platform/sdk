import { authconnection } from "@tailor-platform/sdk/runtime";

const html = "</div>";

export const token = await authconnection.getConnectionToken("google");
