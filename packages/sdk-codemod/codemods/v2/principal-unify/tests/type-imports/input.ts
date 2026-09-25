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

export const actorTypeValue: TailorActorType = "USER_TYPE_USER";
export const actorTypeMissing: TailorActorType = "USER_TYPE_UNSPECIFIED";
export const allowedActorTypes: TailorActorType[] = [
  "USER_TYPE_USER",
  "USER_TYPE_MACHINE_USER",
];
export const actorTypeConfig: { primary: TailorActorType; fallback?: TailorActorType } = {
  primary: "USER_TYPE_USER",
  fallback: "USER_TYPE_UNSPECIFIED",
};

export function isUserType(type: TailorActorType) {
  return type === "USER_TYPE_USER";
}
