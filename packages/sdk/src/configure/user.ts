import type { TailorUser } from "#src/runtime/types";

/** Represents an unauthenticated user in the Tailor platform. */
export const unauthenticatedTailorUser: TailorUser = {
  id: "00000000-0000-0000-0000-000000000000",
  type: "",
  workspaceId: "00000000-0000-0000-0000-000000000000",
  attributes: null,
  attributeList: [],
};
