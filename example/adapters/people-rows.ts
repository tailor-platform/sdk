import { createHttpAdapter } from "@tailor-platform/sdk";
import ml from "multiline-ts";

function esc(v: unknown): string {
  if (v === null || v === undefined) return "";
  const str =
    typeof v === "string" || typeof v === "number" || typeof v === "boolean"
      ? String(v)
      : JSON.stringify(v);
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export default createHttpAdapter({
  name: "people-rows",
  pathPattern: "/people-rows",
  input: {
    get: (req) => {
      const q = req.query.q ?? "";
      return {
        query: ml /* gql */ `
          query Search($q: String!) {
            users(
              query: { name: { contains: $q } }
              first: 20,
              order: [{ field: name, direction: Asc }]
            ) {
              edges {
                node {
                  id
                  name
                  email
                  role
                  status
                }
              }
            }
        }`,
        variables: { q },
      };
    },
  },
  output: (resp) => {
    const data = resp.data as
      | { users?: { edges?: { node: Record<string, unknown> }[] } }
      | null
      | undefined;
    const edges = data?.users?.edges ?? [];
    const rows = edges
      .map(
        ({ node: u }) =>
          `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td>` +
          `<td>${esc(u.role)}</td><td>${esc(u.status)}</td></tr>`,
      )
      .join("");
    return {
      statusCode: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      body: rows || `<tr><td colspan="4">該当なし</td></tr>`,
    };
  },
});
