import { TailorUser } from "../types";
import { FieldMetadata } from "../types/types";

export interface DBFieldMetadata extends FieldMetadata {
  index?: boolean;
  unique?: boolean;
  vector?: boolean;
  foreignKey?: boolean;
  validate?: Function[];
  hooks?: {
    create?: Function;
    update?: Function;
  };
}

export type DefinedFieldMetadata = Partial<
  Omit<DBFieldMetadata, "allowedValues"> & { allowedValues: string[] }
>;

export type DBTypeConfig = {
  withTimestamps?: boolean;
};

export type ValidateFn<O, P = undefined> = (
  args: P extends undefined ? { value: O; user: TailorUser }
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
