import { type TailorDBType } from "../tailordb/schema";
import type {
  AuthConfig,
  AuthServiceInput,
  UserAttributeListKey,
  UserAttributeMap,
} from "./types";
export * from "./types";
export { AuthService } from "./service";

export function defineAuth<
  const User extends TailorDBType,
  const AttributeMap extends UserAttributeMap<User>,
  const AttributeList extends UserAttributeListKey<User>[],
>(name: string, config: AuthServiceInput<User, AttributeMap, AttributeList>) {
  return { name, ...config } as AuthConfig;
}
