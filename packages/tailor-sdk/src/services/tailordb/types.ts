/* eslint-disable @typescript-eslint/no-unsafe-function-type */

import { TailorUser } from "@/types";
import { FieldMetadata } from "@/types/types";

export interface DBFieldMetadata extends FieldMetadata {
  index?: boolean;
  unique?: boolean;
  vector?: boolean;
  foreignKey?: boolean;
  foreignKeyType?: string;
  validate?: Function[];
  hooks?: Hook<any, any>;
}

export type DefinedFieldMetadata = Partial<
  Omit<DBFieldMetadata, "allowedValues"> & { allowedValues: string[] }
>;

export type DBTypeConfig = {
  withTimestamps?: boolean;
  description?: string;
};

type IsDateType<T> = Date extends T ? true : false;
type HookReturn<T> = IsDateType<T> extends true ? string : T;
type HookValue<T> = IsDateType<T> extends true ? string : T;
type HookFn<O, P = undefined> = (
  args: P extends undefined
    ? { value: HookValue<O>; user: TailorUser }
    : { value: HookValue<O>; data: P; user: TailorUser },
) => HookReturn<O>;
export type Hooks<P> = {
  [K in keyof P]?: Hook<P[K], P>;
};
export type Hook<O, P> = {
  create?: HookFn<O, P>;
  update?: HookFn<O, P>;
};

export type ValidateFn<O, P = undefined> = (
  args: P extends undefined
    ? { value: O; user: TailorUser }
    : { value: O; data: P; user: TailorUser },
) => boolean;
export type FieldValidateFn<O> = ValidateFn<O>;
export type FieldValidator<O> =
  | FieldValidateFn<O>
  | {
      script: FieldValidateFn<O>;
      action?: "allow" | "deny";
      error_message?: string;
    };
export type TypeValidateFn<P, O> = (args: {
  value: O;
  data: P;
  user: TailorUser;
}) => boolean;

export type TailorDBServiceConfig = { files: string[] };
export type TailorDBServiceInput = {
  [namespace: string]: TailorDBServiceConfig;
};
