import type { TailorUser, TailorActor, TailorInvoker } from "@tailor-platform/sdk";

export type Props = {
  user: TailorUser;
  actor: TailorActor;
  invoker: TailorInvoker;
  nullableInvoker: TailorInvoker | null;
  invokers: TailorInvoker[];
};
