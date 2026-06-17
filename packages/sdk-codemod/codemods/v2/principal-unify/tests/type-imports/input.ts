import type { TailorUser, TailorActor, TailorInvoker, TailorActorType } from "@tailor-platform/sdk";

export type Props = {
  user: TailorUser;
  actor: TailorActor;
  invoker: TailorInvoker;
  nullableInvoker: TailorInvoker | null;
  invokers: TailorInvoker[];
  actorType: TailorActorType;
};

export function actorFields(actor: TailorActor | null) {
  return {
    id: actor?.userId,
    type: actor?.userType,
  };
}
