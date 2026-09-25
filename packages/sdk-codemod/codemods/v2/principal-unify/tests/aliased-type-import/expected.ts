import { type TailorPrincipal as MyUser, type TailorPrincipal } from "@tailor-platform/sdk";

export type Props = {
  caller: MyUser;
  invoker: (TailorPrincipal | null);
};
