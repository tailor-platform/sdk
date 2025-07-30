import { OperatorFieldConfig } from "@/types/operator";

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
    indexes?: Record<
      string,
      {
        fields: string[];
        unique?: boolean;
      }
    >;
  };
}
