import type { TailorPrincipal } from "@tailor-platform/sdk";

export type Props = {
  user: TailorPrincipal;
  actor: TailorPrincipal;
  invoker: (TailorPrincipal | null);
  nullableInvoker: (TailorPrincipal | null) | null;
  invokers: (TailorPrincipal | null)[];
};
