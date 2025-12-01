// Interfaces for module augmentation
// Users can extend these via: declare module "@tailor-platform/sdk" { interface AttributeMap { ... } }
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface AttributeMap {}
export interface AttributeList {
  __tuple?: []; // Marker for tuple type
}

export type InferredAttributeMap = keyof AttributeMap extends never
  ? Record<string, string | string[] | boolean | boolean[] | undefined>
  : AttributeMap;

export type InferredAttributeList = AttributeList["__tuple"] extends []
  ? string[]
  : AttributeList["__tuple"];

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
  /**
   * A list of the user's attributes.
   * For unauthenticated users, this will be an empty array.
   */
  attributeList: InferredAttributeList;
};

/** Represents an unauthenticated user in the Tailor platform. */
export const unauthenticatedTailorUser: TailorUser = {
  id: "00000000-0000-0000-0000-000000000000",
  type: "",
  workspaceId: "00000000-0000-0000-0000-000000000000",
  attributes: null,
  attributeList: [],
};

// Since there's naming difference between platform and sdk,
// use this mapping in all scripts to provide variables that match sdk types.
export const tailorUserMap = /* js */ `{ id: user.id, type: user.type, workspaceId: user.workspace_id, attributes: user.attribute_map, attributeList: user.attributes }`;
