/** Represents a user in the Tailor platform. */
export type TailorUser = {
  /**
   * The ID of the user.
   * For unauthenticated users, this will be a nil UUID.
   */
  id: string;
  /**
   * The type of the user.
   * For unauthenticated users, this will be an empty string.
   */
  type: "user" | "machine_user" | "";
  /** The ID of the workspace the user belongs to. */
  workspaceId: string;
  /**
   * A map of the user's attributes.
   * For unauthenticated users, this will be null.
   */
  attributes: Record<
    string,
    string | string[] | boolean | boolean[] | undefined
  > | null;
  /** A list of the user's attributes.
   * For unauthenticated users, this will be an empty array.
   */
  attributeList: string[];
};

// Since there's naming difference between platform and sdk,
// use this mapping in all scripts to provide variables that match sdk types.
export const tailorUserMap =
  "{ id: user.id, type: user.type, workspaceId: user.workspace_id, attributes: user.attribute_map, attributeList: user.attributes }";
