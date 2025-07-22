import { TailorUser } from "@/types";
import { output } from "@/types/helpers";
import { FieldMetadata } from "@/types/types";

export interface DBFieldMetadata extends FieldMetadata {
  index?: boolean;
  unique?: boolean;
  vector?: boolean;
  foreignKey?: boolean;
  foreignKeyType?: string;
  validate?: FieldValidateInput<any>[];
  hooks?: Hook<any, any>;
}

export type DefinedFieldMetadata = Partial<
  Omit<DBFieldMetadata, "allowedValues"> & { allowedValues: string[] }
>;

type IsDateType<T> = Date extends T ? true : false;

type DBTypeLike = {
  fields: Record<string, { _defined: Record<string, unknown> }>;
};
type DefinedFields<
  T extends DBTypeLike,
  K extends keyof DBFieldMetadata,
> = keyof {
  [P in keyof T["fields"] as T["fields"][P]["_defined"] extends {
    [Key in K]: unknown;
  }
    ? P
    : never]: keyof T["fields"][P]["_defined"];
};

type UndefinedFields<
  T extends DBTypeLike,
  K extends keyof DBFieldMetadata,
> = Exclude<keyof T["fields"], DefinedFields<T, K>>;

type HookReturn<T> = IsDateType<T> extends true ? string : T;
type HookValue<T> = IsDateType<T> extends true ? string : T;
type HookFn<O, P> = (args: {
  value: HookValue<O>;
  data: P;
  user: TailorUser;
}) => HookReturn<O>;
export type Hook<O, P = unknown> = {
  create?: HookFn<O, P>;
  update?: HookFn<O, P>;
};
export type Hooks<P extends DBTypeLike> = {
  [K in UndefinedFields<P, "hooks">]?: K extends keyof output<P>
    ? Hook<output<P>[K], output<P>>
    : never;
} & {
  [K in DefinedFields<P, "hooks">]?: {
    "hooks already defined in field": never;
  };
};

export type Validators<P extends DBTypeLike> = {
  [K in UndefinedFields<P, "validate">]?: K extends keyof output<P>
    ?
        | ValidateFn<output<P>[K], output<P>>
        | ValidateConfig<output<P>[K], output<P>>
        | (
            | ValidateFn<output<P>[K], output<P>>
            | ValidateConfig<output<P>[K], output<P>>
          )[]
    : never;
} & {
  [K in DefinedFields<P, "validate">]?: {
    "validator already defined in field": never;
  };
};

type ValidateFn<O, D = unknown> = (args: {
  value: O;
  data: D;
  user: TailorUser;
}) => boolean;

export type ValidateConfig<O, D = unknown> = [ValidateFn<O, D>, string];

type FieldValidateFn<O> = ValidateFn<O>;
type FieldValidateConfig<O> = ValidateConfig<O>;
export type FieldValidateInput<O> = FieldValidateFn<O> | FieldValidateConfig<O>;

export type TailorDBServiceConfig = { files: string[] };
export type TailorDBServiceInput = {
  [namespace: string]: TailorDBServiceConfig;
};
