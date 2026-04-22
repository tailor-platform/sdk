import type { InferredAttributeList, InferredAttributeMap } from "./user";

/**
 * Represents the invoker of the current function execution.
 *
 * The invoker reflects `authInvoker` delegation: when `authInvoker` is
 * specified, this is the machine user; otherwise it is the calling user.
 * Distinct from resolver's `user` (the authenticated caller) and executor's
 * `actor` (the subject of the event).
 *
 * `null` when the request has no authenticated caller (anonymous JWT).
 */
export type TailorInvoker = {
  /** The ID of the invoker (user ID or machine user ID). */
  id: string;
  /** The type of the invoker. */
  type: "user" | "machine_user";
  /** The ID of the workspace the invoker belongs to. */
  workspaceId: string;
  /**
   * A map of the invoker's attributes.
   * Maps from the platform's `attributeMap` claim.
   */
  attributes: InferredAttributeMap | null;
  /**
   * A list of the invoker's attribute IDs.
   * Maps from the platform's `attributes` claim.
   */
  attributeList: InferredAttributeList;
} | null;
