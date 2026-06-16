import type { TailorPrincipal } from "@tailor-platform/sdk";
import resolver from "./resolver";

const principal: TailorPrincipal = {
  id: "user-1",
  type: "user",
  workspaceId: "workspace-1",
  attributes: {},
  attributeList: [],
};

export const result = resolver.body({
  input: { id: "user-1" },
  user: principal,
  env: {},
});
