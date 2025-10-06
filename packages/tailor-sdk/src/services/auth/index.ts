import { type TailorDBType } from "../tailordb/schema";
import {
  AuthConfigSchema,
  type AuthServiceInput,
  type UserAttributeListKey,
  type UserAttributeMap,
} from "./types";
export * from "./types";
export { AuthService } from "./service";

export function defineAuth<
  const User extends TailorDBType,
  const AttributeMap extends UserAttributeMap<User>,
  const AttributeList extends UserAttributeListKey<User>[],
>(name: string, config: AuthServiceInput<User, AttributeMap, AttributeList>) {
  return AuthConfigSchema.parse({ name, ...config });
}
