// Type-level checks against the generated `tailor.d.ts`. Once `tailor
// generate` augments `MachineUserNameRegistry`, `MachineUserName` narrows to the
// registered machine user union for both SDK entries — `@tailor-platform/sdk`
// (resolver `invoker`) and `@tailor-platform/sdk/cli` (workflow-start
// `invoker`), which share the single `@tailor-platform/sdk` augmentation.
import type {
  MachineUserInvoker,
  MachineUserName as SdkMachineUserName,
} from "@tailor-platform/sdk";
import type { MachineUserName as CliMachineUserName } from "@tailor-platform/sdk/cli";

const sdkInvoker: SdkMachineUserName = "manager-machine-user";
const cliInvoker: CliMachineUserName = "manager-machine-user";

// @ts-expect-error - unknown machine user names are rejected once tailor.d.ts is generated
const unknownSdkInvoker: SdkMachineUserName = "unknown-machine-user";
// @ts-expect-error - unknown machine user names are rejected once tailor.d.ts is generated
const unknownCliInvoker: CliMachineUserName = "unknown-machine-user";

const objectInvoker: MachineUserInvoker = {
  namespace: "my-auth",
  machineUserName: "manager-machine-user",
};
const unknownNamespaceInvoker: MachineUserInvoker = {
  // @ts-expect-error - unknown Auth service names are rejected once tailor.d.ts is generated
  namespace: "unknown-auth",
  machineUserName: "manager-machine-user",
};
const unknownObjectMachineUserInvoker: MachineUserInvoker = {
  namespace: "my-auth",
  // @ts-expect-error - unknown machine user names are rejected once tailor.d.ts is generated
  machineUserName: "unknown-machine-user",
};

export const invokerTypeChecks = [
  sdkInvoker,
  cliInvoker,
  unknownSdkInvoker,
  unknownCliInvoker,
  objectInvoker,
  unknownNamespaceInvoker,
  unknownObjectMachineUserInvoker,
];
