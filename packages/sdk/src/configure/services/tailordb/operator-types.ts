import { type Permissions } from "./permission";

export interface TailorDBTypeMetadata {
  name: string;
  description?: string;
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
}
