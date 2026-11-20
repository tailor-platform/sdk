import { describe, expect, test } from "vitest";
import { guardRequest } from "./request-guard";

const PORT = 7777;

function request(
  method: string,
  headers: Record<string, string> = {},
  url = `http://127.0.0.1:${PORT}/`,
) {
  return new Request(url, { method, headers });
}

function guard(req: Request) {
  return guardRequest(req, { port: PORT });
}

describe("guardRequest", () => {
  describe("port 80, where a browser leaves the port out of Host and Origin", () => {
    const onPort80 = (method: string, headers: Record<string, string>) =>
      guardRequest(new Request("http://127.0.0.1/", { method, headers }), { port: 80 });

    test.each(["127.0.0.1", "localhost", "127.0.0.1:80"])("allows Host %s", (host) => {
      expect(onPort80("GET", { host })).toBeUndefined();
    });

    test("allows a write from the portless Origin", () => {
      expect(
        onPort80("POST", {
          host: "127.0.0.1",
          "sec-fetch-site": "same-origin",
          origin: "http://127.0.0.1",
        }),
      ).toBeUndefined();
    });

    test("still rejects the portless Host when the server is on another port", () => {
      expect(guard(request("GET", { host: "127.0.0.1" }))?.status).toBe(403);
    });
  });

  describe("Host header", () => {
    test.each([`127.0.0.1:${PORT}`, `localhost:${PORT}`])("allows %s", (host) => {
      expect(guard(request("GET", { host }))).toBeUndefined();
    });

    test.each([`evil.example:${PORT}`, `127.0.0.1:${PORT + 1}`, "127.0.0.1"])(
      "rejects %s with 403 so a rebound DNS name cannot read local files",
      (host) => {
        expect(guard(request("GET", { host }))?.status).toBe(403);
      },
    );
  });

  describe("write requests", () => {
    const host = `127.0.0.1:${PORT}`;
    const sameOrigin = { host, "sec-fetch-site": "same-origin" };

    test.each(["POST", "PUT", "PATCH", "DELETE"])(
      "%s without Sec-Fetch-Site is 403, so a client that is not a page of the shell cannot write",
      (method) => {
        expect(guard(request(method, { host }))?.status).toBe(403);
      },
    );

    test.each(["none", "same-site", "cross-site"])("POST marked %s is 403", (site) => {
      expect(guard(request("POST", { host, "sec-fetch-site": site }))?.status).toBe(403);
    });

    test("POST marked same-origin is allowed", () => {
      expect(guard(request("POST", sameOrigin))).toBeUndefined();
    });

    test("POST from a foreign Origin is 403 even when marked same-origin", () => {
      expect(guard(request("POST", { ...sameOrigin, origin: "http://evil.example" }))?.status).toBe(
        403,
      );
    });

    test.each([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`])(
      "POST from Origin %s is allowed",
      (origin) => {
        expect(guard(request("POST", { ...sameOrigin, origin }))).toBeUndefined();
      },
    );
  });

  describe("Sec-Fetch-Site on read requests", () => {
    const host = `127.0.0.1:${PORT}`;

    test.each(["none", "same-origin"])("GET marked %s is allowed", (site) => {
      expect(guard(request("GET", { host, "sec-fetch-site": site }))).toBeUndefined();
    });

    test.each(["cross-site", "same-site"])(
      "GET marked %s is 403 so another page cannot make the browser trigger a tab's work",
      (site) => {
        expect(guard(request("GET", { host, "sec-fetch-site": site }))?.status).toBe(403);
        expect(guard(request("HEAD", { host, "sec-fetch-site": site }))?.status).toBe(403);
      },
    );

    test("GET without the header (a non-browser client) is allowed", () => {
      expect(guard(request("GET", { host }))).toBeUndefined();
    });
  });

  test("read requests need no token", () => {
    expect(guard(request("GET", { host: `127.0.0.1:${PORT}` }))).toBeUndefined();
    expect(guard(request("HEAD", { host: `127.0.0.1:${PORT}` }))).toBeUndefined();
  });
});
