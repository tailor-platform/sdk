import { describe, expect, test } from "vitest";
import { guardRequest } from "./request-guard";

const PORT = 7777;
const TOKEN = "t0ken";

function request(
  method: string,
  headers: Record<string, string> = {},
  url = `http://127.0.0.1:${PORT}/`,
) {
  return new Request(url, { method, headers });
}

function guard(req: Request) {
  return guardRequest(req, { port: PORT, token: TOKEN });
}

describe("guardRequest", () => {
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

    test.each(["POST", "PUT", "PATCH", "DELETE"])("%s without the token is 403", (method) => {
      expect(guard(request(method, { host }))?.status).toBe(403);
    });

    test("POST with the token is allowed", () => {
      expect(guard(request("POST", { host, "x-tailor-webui-token": TOKEN }))).toBeUndefined();
    });

    test("POST with a wrong token is 403", () => {
      expect(guard(request("POST", { host, "x-tailor-webui-token": "nope" }))?.status).toBe(403);
    });

    test("POST from a foreign Origin is 403 even with the token", () => {
      const res = guard(
        request("POST", { host, origin: "http://evil.example", "x-tailor-webui-token": TOKEN }),
      );
      expect(res?.status).toBe(403);
    });

    test.each([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`])(
      "POST from Origin %s with the token is allowed",
      (origin) => {
        expect(
          guard(request("POST", { host, origin, "x-tailor-webui-token": TOKEN })),
        ).toBeUndefined();
      },
    );
  });

  test("read requests need no token", () => {
    expect(guard(request("GET", { host: `127.0.0.1:${PORT}` }))).toBeUndefined();
    expect(guard(request("HEAD", { host: `127.0.0.1:${PORT}` }))).toBeUndefined();
  });
});
