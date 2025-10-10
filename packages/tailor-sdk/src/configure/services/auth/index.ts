import z from "zod";
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
  const MachineUserNames extends string,
>(
  name: string,
  config: AuthServiceInput<User, AttributeMap, AttributeList, MachineUserNames>,
) {
  return AuthConfigSchema.and(
    getInvokerFnSchema(
      Object.keys(config.machineUsers ?? {}) as MachineUserNames[],
    ),
  ).parse({
    ...config,
    name,
    invoker(machineUser: MachineUserNames) {
      return { authName: name, machineUser } as const;
    },
  });
}

export const getInvokerFnSchema = <const MachineUserNames extends string[]>(
  machineUserName: MachineUserNames,
) =>
  z.object({
    invoker: z.function({
      input: [z.enum(machineUserName)],
      output: z.object({
        authName: z.string(),
        machineUser: z.string(),
      }),
    }),
  });
