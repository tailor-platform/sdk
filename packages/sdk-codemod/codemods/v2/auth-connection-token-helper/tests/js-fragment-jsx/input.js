import { auth } from "../tailor.config";

export const view = <>{await auth.getConnectionToken("google")}</>;
