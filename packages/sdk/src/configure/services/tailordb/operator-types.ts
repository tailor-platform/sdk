import { type OperatorFieldConfig } from "@/parser/service/tailordb/types";
import { type Permissions } from "./permission";

export interface TailorDBTypeConfig {
  name: string;
  schema: {
    description?: string;
    extends: boolean;
    fields: Record<string, OperatorFieldConfig>;
    settings?: {
      pluralForm?: string;
      aggregation?: boolean;
      bulkUpsert?: boolean;
    };
    permissions: Permissions;
    files: Record<string, string>;
    indexes?: Record<
      string,
      {
        fields: string[];
        unique?: boolean;
      }
    >;
  };
}
