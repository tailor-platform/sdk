import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "list-org-members",
  description: "List members of an organization",
  operation: "query",
  input: {
    organizationId: t.uuid(),
  },
  body: () => [] as { id: string; email: string; roles: string[] }[],
  output: t.object(
    {
      id: t.string(),
      email: t.string(),
      roles: t.string({ array: true }),
    },
    { array: true },
  ),
});
