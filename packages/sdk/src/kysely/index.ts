/**
 * Re-exports from kysely and function-kysely-tailordb packages.
 *
 * This module provides a single import path for kysely-related types and classes
 * used in generated code, avoiding phantom dependency issues with pnpm.
 */

export {
  type ColumnType,
  Kysely,
  type KyselyConfig,
  type Transaction,
  type Insertable,
  type Selectable,
  type Updateable,
} from "kysely";

export { TailordbDialect } from "@tailor-platform/function-kysely-tailordb";
