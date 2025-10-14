import { type TailorDBType } from "../tailordb/schema";
import type { parseAuthConfig } from "@/parser/service/auth";
import {
  type AuthServiceInput,
  type UserAttributeListKey,
  type UserAttributeMap,
} from "@/parser/service/auth/schema";
export type * from "@/parser/service/auth";
export { AuthService } from "./service";

export function defineAuth<
  const User extends TailorDBType,
  const AttributeMap extends UserAttributeMap<User>,
  const AttributeList extends UserAttributeListKey<User>[],
  const MachineUserNames extends string,
>(
  name: string,
  config: AuthServiceInput<User, AttributeMap, AttributeList, MachineUserNames>,
) {
  return {
    ...config,
    name,
    invoker(machineUser: MachineUserNames) {
      return { authName: name, machineUser } as const;
    },
  } as const satisfies Parameters<
    typeof parseAuthConfig<User, AttributeMap, AttributeList, MachineUserNames>
  >[0];
}

export type AuthConfig = ReturnType<typeof defineAuth>;
