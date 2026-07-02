import { authconnection } from "@tailor-platform/sdk/runtime";

export const view = <>{await authconnection.getConnectionToken("google")}</>;
