export type TailorUser = {
  // Nil UUID means unauthenticated user
  id: string;
  // Empty string means unauthenticated user
  type: "user" | "machine_user" | "";
  workspace_id: string;
  attributes: string[];
};
