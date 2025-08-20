import { OperatorFieldConfig } from "@/types/operator";
import { Permissions } from "./permission";

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
    indexes?: Record<
      string,
      {
        fields: string[];
        unique?: boolean;
      }
    >;
  };
}
