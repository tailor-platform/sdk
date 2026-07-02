import { authconnection } from "@tailor-platform/sdk/runtime";

export const view = <Widget token={await authconnection.getConnectionToken("google")} />;
