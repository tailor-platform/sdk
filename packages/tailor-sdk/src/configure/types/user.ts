declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace TailorSDK {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface AttributeMap {}
    interface AttributeList {
      __tuple?: []; // Marker for tuple type
    }
  }
}

export type InferredAttributeMap = keyof TailorSDK.AttributeMap extends never
  ? Record<string, string | string[] | boolean | boolean[] | undefined>
  : TailorSDK.AttributeMap;

export type InferredAttributeList =
  TailorSDK.AttributeList["__tuple"] extends []
    ? string[]
    : TailorSDK.AttributeList["__tuple"];

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
  attributes: InferredAttributeMap | null;
  /** A list of the user's attributes.
   * For unauthenticated users, this will be an empty array.
   */
  attributeList: InferredAttributeList;
};

// Since there's naming difference between platform and sdk,
// use this mapping in all scripts to provide variables that match sdk types.
export const tailorUserMap = /* js */ `{ id: user.id, type: user.type, workspaceId: user.workspace_id, attributes: user.attribute_map, attributeList: user.attributes }`;
