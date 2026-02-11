import type { AuthInvoker } from "@tailor-platform/sdk";

const AUTH_NAMESPACE = "my-auth" as const;
type MachineUserName = "manager-machine-user";

export const auth = {
  invoker<M extends MachineUserName>(machineUser: M): AuthInvoker<M> {
    return {
      namespace: AUTH_NAMESPACE,
      machineUserName: machineUser,
    } as const;
  },
} as const;
