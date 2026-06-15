import type { InferredAttributeList, InferredAttributeMap } from "./user";

/**
 * User type enum values from the Tailor Platform server.
 *
 * @deprecated `TailorPrincipal` represents the type as `"user"` or
 * `"machine_user"`. This enum is removed in the next major version.
 */
export type TailorActorType = "USER_TYPE_USER" | "USER_TYPE_MACHINE_USER" | "USER_TYPE_UNSPECIFIED";

/**
 * Represents an actor in event triggers.
 *
 * @deprecated Use `TailorPrincipal` instead. `TailorActor` is unified into
 * `TailorPrincipal` in the next major version, where `userId`/`userType` become
 * `id`/`type` with `"user"`/`"machine_user"` values.
 */
export type TailorActor = {
  /** The ID of the workspace the user belongs to. */
  workspaceId: string;
  /** The ID of the user. */
  userId: string;
  /**
   * A map of the user's attributes.
   * Maps from server's `attributeMap` field.
   */
  attributes: InferredAttributeMap | null;
  /**
   * A list of the user's attributes.
   * Maps from server's `attributes` field.
   */
  attributeList: InferredAttributeList;
  /** The type of the user. */
  userType: TailorActorType;
};
