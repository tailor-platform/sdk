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

/** Represents a user or machine user principal in the Tailor Platform. */
export type TailorPrincipal = {
  /** The ID of the principal. */
  id: string;
  /** The type of the principal. */
  type: "user" | "machine_user";
  /** The ID of the workspace the principal belongs to. */
  workspaceId: string;
  /** A map of the principal's attributes. */
  attributes: InferredAttributeMap;
  /** A list of the principal's attribute IDs. */
  attributeList: InferredAttributeList;
};
