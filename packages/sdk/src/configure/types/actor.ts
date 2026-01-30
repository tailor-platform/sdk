import type { InferredAttributeList, InferredAttributeMap } from "./user";

/** User type enum values from the Tailor Platform server. */
export type TailorActorType = "USER_TYPE_USER" | "USER_TYPE_MACHINE_USER" | "USER_TYPE_UNSPECIFIED";

/** Represents an actor in event triggers. */
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
