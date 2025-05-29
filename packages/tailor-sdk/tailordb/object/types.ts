import { TailorField, User } from "../../types";
import { AllowedValue } from "../../types/field";

export type DBFieldMetadata = {
  description?: string;
  type: TailorField;
  required?: boolean;
  allowedValues?: AllowedValue[];
  array?: boolean;
  index?: boolean;
  unique?: boolean;
  vector?: boolean;
  foreignKey?: boolean;
  validate?: Function[];
  hooks?: {
    create?: Function;
    update?: Function;
  };
};

export type DefinedFieldMetadata = Partial<
  Omit<DBFieldMetadata, "allowedValues"> & { allowedValues: string[] }
>;

export type DBTypeConfig = {
  withTimestamps?: boolean;
};

export type ValidateFn<O, P = undefined> = (
  args: P extends undefined ? { value: O; user: User }
    : { value: O; data: P; user: User },
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
  user: User;
}) => boolean;
