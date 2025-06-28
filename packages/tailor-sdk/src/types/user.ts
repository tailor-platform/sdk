export type TailorUser = {
  id: string;
  attributes: unknown[];
  tenant_id: string;
  type: "machine_user" | "user";
  workspace_id: string;
};
