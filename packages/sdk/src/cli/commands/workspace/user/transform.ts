import { WorkspacePlatformUserRole } from "@tailor-platform/tailor-proto/workspace_resource_pb";
import { CLIError } from "#/cli/shared/errors";
import { parseProtoEnumName, protoEnumName, protoEnumNames } from "#/cli/shared/proto-enum";
import type { WorkspacePlatformUser } from "@tailor-platform/tailor-proto/workspace_resource_pb";

export interface UserInfo {
  userId: string;
  email: string;
  role: string;
}

type RoleName = Lowercase<Exclude<keyof typeof WorkspacePlatformUserRole, "UNSPECIFIED">>;

export const validRoles = protoEnumNames(WorkspacePlatformUserRole)
  .filter((name) => name !== "UNSPECIFIED")
  .map((name) => name.toLowerCase()) as RoleName[];

const roleToString = (role: WorkspacePlatformUserRole): string => {
  const name = protoEnumName(WorkspacePlatformUserRole, role);
  return name === undefined || role === WorkspacePlatformUserRole.UNSPECIFIED
    ? "unknown"
    : name.toLowerCase();
};

export const stringToRole = (role: string): WorkspacePlatformUserRole => {
  const parsed = parseProtoEnumName(WorkspacePlatformUserRole, role, [
    WorkspacePlatformUserRole.UNSPECIFIED,
  ]);
  if (parsed === undefined) {
    throw CLIError({
      code: "WORKSPACE_ROLE_INVALID",
      message: `Invalid role: ${role}. Valid roles: ${validRoles.join(", ")}`,
    });
  }
  return parsed;
};

export const userInfo = (user: WorkspacePlatformUser): UserInfo => {
  return {
    userId: user.platformUser?.userId ?? "",
    email: user.platformUser?.email ?? "",
    role: roleToString(user.role),
  };
};
