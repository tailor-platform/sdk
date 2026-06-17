import { createHttpAdapter } from "@tailor-platform/sdk";

// Probes per-method dispatch end-to-end: each handler issues the same GraphQL
// query under a different alias, so the output handler can tell which input
// branch ran by inspecting which key is present in the response.
export default createHttpAdapter({
  name: "echo-method",
  pathPattern: "/echo",
  input: {
    get: () => ({
      query: `query { getResult: showUserInfo { caller { role } } }`,
    }),
    post: () => ({
      query: `query { postResult: showUserInfo { caller { role } } }`,
    }),
  },
  output: (resp) => {
    const data = (resp.data ?? {}) as Record<string, unknown>;
    const key = Object.keys(data)[0] ?? "unknown";
    return {
      statusCode: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
      body: key,
    };
  },
});
