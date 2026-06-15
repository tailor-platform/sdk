import { createResolver, t, type TailorUser } from "@tailor-platform/sdk";

type CustomerRow = {
  name: string;
  email: string;
};

export function principalLabel(user: TailorUser): string {
  return `${user.type}:${user.id}`;
}

export default createResolver({
  name: "customerLookup",
  operation: "query",
  input: {
    email: t.string(),
  },
  output: {
    greeting: t.string(),
    requestedBy: t.string(),
  },
  body: async ({ input, user, env }) => {
    const client = new tailordb.Client({ namespace: "tailordb" });
    await client.connect();
    try {
      const result = await client.queryObject<CustomerRow>(
        "SELECT name, email FROM Customer WHERE email = $1",
        [input.email],
      );
      const customer = result.rows[0] ?? { name: "unknown", email: input.email };
      return {
        greeting: `${env.APP_NAME ?? "App"}:${customer.name}`,
        requestedBy: principalLabel(user),
      };
    } finally {
      await client.end();
    }
  },
});
