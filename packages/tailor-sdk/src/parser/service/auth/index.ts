import z from "zod";
import { AuthConfigSchema } from "./schema";
import type {
  AuthServiceInput,
  UserAttributeListKey,
  UserAttributeMap,
} from "./types";
import type { TailorDBType } from "@/configure/services/tailordb/schema";
export type * from "./types";

export function parseAuthConfig<
  const User extends TailorDBType,
  const AttributeMap extends UserAttributeMap<User>,
  const AttributeList extends UserAttributeListKey<User>[],
  const MachineUserNames extends string,
>(
  config: Readonly<
    AuthServiceInput<User, AttributeMap, AttributeList, MachineUserNames> &
      z.input<ReturnType<typeof getInvokerFnSchema<MachineUserNames>>> & {
        name: string;
      }
  >,
) {
  return AuthConfigSchema.and(
    getInvokerFnSchema(Object.keys(config.machineUsers ?? {})),
  ).parse(config);
}

function getInvokerFnSchema<const MachineUserNames extends string>(
  machineUserName: MachineUserNames[],
) {
  return z.object({
    invoker: z.function({
      input: [z.enum(machineUserName)],
      output: z.object({
        authName: z.string(),
        machineUser: z.string(),
      }),
    }),
  });
}
