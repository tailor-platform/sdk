import { WorkspacePlatformUserRole } from "@tailor-proto/tailor/v1/workspace_resource_pb";
import type { WorkspacePlatformUser } from "@tailor-proto/tailor/v1/workspace_resource_pb";

export interface UserInfo {
  userId: string;
  email: string;
  role: string;
}

const roleToString = (role: WorkspacePlatformUserRole): string => {
  switch (role) {
    case WorkspacePlatformUserRole.ADMIN:
      return "admin";
    case WorkspacePlatformUserRole.EDITOR:
      return "editor";
    case WorkspacePlatformUserRole.VIEWER:
      return "viewer";
    default:
      return "unknown";
  }
};

export const stringToRole = (role: string): WorkspacePlatformUserRole => {
  switch (role.toLowerCase()) {
    case "admin":
      return WorkspacePlatformUserRole.ADMIN;
    case "editor":
      return WorkspacePlatformUserRole.EDITOR;
    case "viewer":
      return WorkspacePlatformUserRole.VIEWER;
    default:
      throw new Error(`Invalid role: ${role}. Valid roles: admin, editor, viewer`);
  }
};

export const userInfo = (user: WorkspacePlatformUser): UserInfo => {
  return {
    userId: user.platformUser?.userId ?? "",
    email: user.platformUser?.email ?? "",
    role: roleToString(user.role),
  };
};

export const validRoles = ["admin", "editor", "viewer"] as const;
