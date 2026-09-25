import type { TailorPrincipal } from "@tailor-platform/sdk";

export type Props = {
  user: TailorPrincipal;
  actor: TailorPrincipal;
  invoker: (TailorPrincipal | null);
  nullableInvoker: (TailorPrincipal | null) | null;
  invokers: (TailorPrincipal | null)[];
  actorType: (TailorPrincipal["type"] | undefined);
};

export function actorFields(actor: TailorPrincipal | null) {
  return {
    id: actor?.id,
    type: actor?.type,
  };
}

export const actorTypeValue: (TailorPrincipal["type"] | undefined) = "user";
export const actorTypeMissing: (TailorPrincipal["type"] | undefined) = undefined;
export const allowedActorTypes: (TailorPrincipal["type"] | undefined)[] = [
  "user",
  "machine_user",
];
export const actorTypeConfig: { primary: (TailorPrincipal["type"] | undefined); fallback?: (TailorPrincipal["type"] | undefined) } = {
  primary: "user",
  fallback: undefined,
};

export function isUserType(type: (TailorPrincipal["type"] | undefined)) {
  return type === "user";
}
