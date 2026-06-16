import type { TailorPrincipal } from "@tailor-platform/sdk";

declare const client: {
  body(args: { input: unknown; user: TailorPrincipal | null; env: Record<string, string> }): unknown;
};
declare const principal: TailorPrincipal;

export const result = client.body({
  input: { id: "user-1" },
  user: principal,
  env: {},
});
