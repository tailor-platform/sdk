import { defineHttpAdapter } from "@tailor-platform/sdk";

function escapeXml(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str =
    typeof value === "string" || typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : JSON.stringify(value);
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export default defineHttpAdapter({
  name: "get-user",
  pathPattern: "/users/*",
  methods: ["GET"],
  input: (req) => {
    const segments = req.path.split("/").filter(Boolean);
    const id = segments[segments.length - 1] ?? "";
    return {
      query: `query GetUser($id: ID!) {
        user(id: $id) {
          id
          name
          email
          role
          status
        }
      }`,
      variables: { id },
    };
  },
  output: (resp) => {
    const data = resp.data as { user: Record<string, unknown> | null } | null | undefined;
    const user = data?.user;
    if (!user) {
      return {
        statusCode: 404,
        headers: { "content-type": "application/xml; charset=utf-8" },
        body: `<?xml version="1.0" encoding="UTF-8"?>\n<error>user not found</error>`,
      };
    }
    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<user>` +
      `<id>${escapeXml(user.id)}</id>` +
      `<name>${escapeXml(user.name)}</name>` +
      `<email>${escapeXml(user.email)}</email>` +
      `<role>${escapeXml(user.role)}</role>` +
      `<status>${escapeXml(user.status)}</status>` +
      `</user>`;
    return {
      statusCode: 200,
      headers: { "content-type": "application/xml; charset=utf-8" },
      body: xml,
    };
  },
});
