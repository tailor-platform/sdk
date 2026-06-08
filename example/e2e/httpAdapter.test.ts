import { randomUUID } from "node:crypto";
import { gql } from "graphql-request";
import { beforeAll, describe, expect, inject, test } from "vitest";
import { createGraphQLClient } from "./utils";

const appUrl = inject("url");
const token = inject("token");

function adapterRequest(method: string, path: string) {
  const url = new URL(`/api${path}`, appUrl).href;
  return fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  });
}

describe("HTTP adapter routing", () => {
  test("GET /api/whoami returns XML payload from the configured adapter", async () => {
    const res = await adapterRequest("GET", "/whoami");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("application/xml");
    const body = await res.text();
    expect(body).toContain("<whoami>");
    expect(body).toMatch(/<user>[\s\S]*<\/user>/);
  });

  test("POST /api/whoami fails with 404 because the adapter only declares GET", async () => {
    const res = await adapterRequest("POST", "/whoami");
    expect(res.status).toBe(404);
  });

  test("GET on an unmapped path fails with 404", async () => {
    const res = await adapterRequest("GET", `/no-adapter-${randomUUID()}`);
    expect(res.status).toBe(404);
  });
});

describe("HTTP adapter with path wildcard", () => {
  const graphQLClient = createGraphQLClient(appUrl, token);
  let userId = "";
  let userName = "";

  beforeAll(async () => {
    userName = `http-adapter-${randomUUID()}`;
    const result = await graphQLClient.rawRequest<{
      createUser: { id: string };
    }>(gql`
      mutation {
        createUser(input: {
          name: "${userName}"
          email: "${userName}@example.com"
          role: MANAGER
        }) {
          id
        }
      }
    `);
    if (result.errors) {
      throw new Error(JSON.stringify(result.errors));
    }
    userId = result.data.createUser.id;
  });

  test("GET /api/users/{id} returns the user as XML", async () => {
    const res = await adapterRequest("GET", `/users/${userId}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("application/xml");
    const body = await res.text();
    expect(body).toContain(`<id>${userId}</id>`);
    expect(body).toContain(`<name>${userName}</name>`);
  });

  test("GET /api/users/{missing} returns 404 from the adapter's own output handler", async () => {
    const res = await adapterRequest("GET", `/users/${randomUUID()}`);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type") ?? "").toContain("application/xml");
    const body = await res.text();
    expect(body).toContain("user not found");
  });
});

describe("HTTP adapter per-method dispatch", () => {
  // The /echo adapter wires GET and POST handlers that issue the same query
  // under different GraphQL aliases, so the response body identifies which
  // handler ran. This proves the bundled input script's switch(req.method)
  // dispatch is wired through to the platform.
  test("GET /api/echo invokes the GET handler", async () => {
    const res = await adapterRequest("GET", "/echo");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("getResult");
  });

  test("POST /api/echo invokes the POST handler", async () => {
    const res = await adapterRequest("POST", "/echo");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("postResult");
  });

  test("PUT /api/echo is rejected because no PUT handler is configured", async () => {
    const res = await adapterRequest("PUT", "/echo");
    expect(res.status).toBe(404);
  });
});
