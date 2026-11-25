export interface ProfileInfo {
  name: string;
  user: string;
  workspaceId: string;
  permission: "read" | "write";
  machineUser?: string | undefined;
  machineUserOverride?: "allow" | "deny" | undefined;
  platformUrl?: string | undefined;
  oauth2ClientId?: string | undefined;
  consoleUrl?: string | undefined;
}
