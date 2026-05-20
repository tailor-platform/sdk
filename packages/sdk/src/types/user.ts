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

/**
 * The invoker of the current function execution.
 *
 * Reflects `authInvoker` delegation: when `authInvoker` is specified, this is
 * the machine user; otherwise it is the calling user.
 * Distinct from resolver's `user` (the authenticated caller) and executor's
 * `actor` (the subject of the event).
 *
 * `null` for anonymous requests.
 *
 * TODO(v2): unify with `TailorUser` — same underlying principal shape.
 */
export type TailorInvoker = {
  /** The ID of the invoker (user ID or machine user ID). */
  id: string;
  /** The type of the invoker. */
  type: "user" | "machine_user";
  /** The ID of the workspace the invoker belongs to. */
  workspaceId: string;
  /** A map of the invoker's attributes. */
  attributes: InferredAttributeMap;
  /** A list of the invoker's attribute IDs. */
  attributeList: InferredAttributeList;
} | null;
