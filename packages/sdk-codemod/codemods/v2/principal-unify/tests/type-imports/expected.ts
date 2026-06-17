import type { TailorPrincipal } from "@tailor-platform/sdk";

export type Props = {
  user: TailorPrincipal;
  actor: TailorPrincipal;
  invoker: (TailorPrincipal | null);
  nullableInvoker: (TailorPrincipal | null) | null;
  invokers: (TailorPrincipal | null)[];
  actorType: TailorPrincipal["type"];
};

export function actorFields(actor: TailorPrincipal | null) {
  return {
    id: actor?.id,
    type: actor?.type,
  };
}

export const actorTypeValue: TailorPrincipal["type"] = "user";
