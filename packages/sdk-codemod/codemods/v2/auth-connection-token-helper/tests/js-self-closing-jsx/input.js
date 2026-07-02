import { auth } from "../tailor.config";

export const view = <Widget token={await auth.getConnectionToken("google")} />;
