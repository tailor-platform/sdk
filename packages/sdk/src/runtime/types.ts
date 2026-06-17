// Shared runtime principal/environment types.
//
// This is a pure type module: it must contain type declarations only and may
// not reference zod or schema modules, so every layer can import it type-only
// without pulling any runtime dependency.

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

// Interface for module augmentation
// Users can extend via: declare module "@tailor-platform/sdk" { interface Env { ... } }
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Env {}

/** Represents environment variables in the Tailor platform. */
export type TailorEnv = keyof Env extends never ? Record<string, string | number | boolean> : Env;
