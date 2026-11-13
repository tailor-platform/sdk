import {
  createResolver,
  t,
  type MachineUserName as SdkMachineUserName,
  type TailorPrincipal,
} from "@tailor-platform/sdk";
import { getDB } from "@tailor-platform/sdk/plugin/kysely-type/db";
import type { MachineUserName as CliMachineUserName } from "@tailor-platform/sdk/cli";

const sdkInvoker: SdkMachineUserName = "admin-machine-user";
const cliInvoker: CliMachineUserName = "admin-machine-user";
// @ts-expect-error - only machine users defined in tailor.config.ts are accepted
const unknownSdkInvoker: SdkMachineUserName = "admin-machine-usr";
// @ts-expect-error - only machine users defined in tailor.config.ts are accepted
const unknownCliInvoker: CliMachineUserName = "admin-machine-usr";

const role: TailorPrincipal["attributes"]["role"] = "MEMBER";
// @ts-expect-error - the role attribute takes the values of the User.role enum
const unknownRole: TailorPrincipal["attributes"]["role"] = "OWNER";

const envTypeChecks = createResolver({
  name: "envTypeChecks",
  operation: "query",
  body: ({ env }) => {
    const greeting: string = env.greeting;
    const pageSize: number = env.pageSize;
    // @ts-expect-error - env has only the keys defined in tailor.config.ts
    const missing = env.missing;
    return `${greeting} ${pageSize} ${missing}`;
  },
  output: t.string(),
});

const userQuery = getDB("main-db").selectFrom("User").select(["name", "role"]);
// @ts-expect-error - only tables defined in src/db/ are known
const unknownTableQuery = getDB("main-db").selectFrom("Users");

export const contentMapperTypeChecks = [
  sdkInvoker,
  cliInvoker,
  unknownSdkInvoker,
  unknownCliInvoker,
  role,
  unknownRole,
  envTypeChecks,
  userQuery,
  unknownTableQuery,
];
