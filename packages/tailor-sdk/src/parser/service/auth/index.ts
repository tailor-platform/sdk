import z from "zod";
import { AuthConfigSchema } from "./schema";
import type {
  ParseAuthConfigInput,
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
  config: ParseAuthConfigInput<
    User,
    AttributeMap,
    AttributeList,
    MachineUserNames
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
