import { type TailorUser as MyUser, type TailorInvoker as MyInvoker } from "@tailor-platform/sdk";

export type Props = {
  caller: MyUser;
  invoker: MyInvoker;
};
