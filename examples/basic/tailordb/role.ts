import { db } from "@tailor-platform/tailor-sdk";
import {
  defaultGqlPermission,
  defaultPermission,
  PermissionUser,
} from "./permissions";

export const role = db
  .type("Role", { name: db.string() })
  .permission<PermissionUser>(defaultPermission)
  .gqlPermission<PermissionUser>(defaultGqlPermission);
export type role = typeof role;
