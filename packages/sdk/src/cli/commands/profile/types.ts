export interface ProfileInfo {
  name: string;
  user: string;
  workspaceId: string;
  permission: "read" | "write";
  machineUser?: string;
  machineUserOverride?: "allow" | "deny";
}
