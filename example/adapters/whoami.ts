import { createHttpAdapter } from "@tailor-platform/sdk";

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

function actorXml(tag: string, actor: Record<string, unknown> | undefined): string {
  if (!actor) return `<${tag} />`;
  return (
    `<${tag}>` +
    `<id>${escapeXml(actor.id)}</id>` +
    `<type>${escapeXml(actor.type)}</type>` +
    `<role>${escapeXml(actor.role)}</role>` +
    `</${tag}>`
  );
}

export default createHttpAdapter({
  name: "whoami",
  pathPattern: "/whoami",
  input: {
    get: () => ({
      query: `query Whoami {
        showUserInfo {
          user {
            id
            type
            role
          }
          invoker {
            id
            type
            role
          }
        }
      }`,
    }),
  },
  output: (resp) => {
    const data = resp.data as
      | {
          showUserInfo?: {
            user?: Record<string, unknown>;
            invoker?: Record<string, unknown>;
          };
        }
      | null
      | undefined;
    const info = data?.showUserInfo;
    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<whoami>` +
      actorXml("user", info?.user) +
      actorXml("invoker", info?.invoker) +
      `</whoami>`;
    return {
      statusCode: 200,
      headers: { "content-type": "application/xml; charset=utf-8" },
      body: xml,
    };
  },
});
