import { auth /* cfg */, defineAuth } from "../tailor.config";

export const token = await auth.getConnectionToken("google");
export const authConfig = defineAuth();
