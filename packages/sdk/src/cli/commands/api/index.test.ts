import { randomUUID } from "node:crypto";
import { runCommand } from "politty";
import { afterEach, describe, expect, test, vi } from "vitest";
import { getMethodDescriptor } from "./proto-reflect";
import { apiCommand, normalizeBodyFieldKeys } from "./index";

const apiCallMock = vi.hoisted(() => vi.fn());
vi.mock("./api-call", () => ({ apiCall: apiCallMock }));

describe("normalizeBodyFieldKeys", () => {
  test("collapses snake_case body keys to localName so injection cannot duplicate them", () => {
    // Reproduces the AddCustomDomain regression: a --body written in snake_case
    // must be recognized so workspaceId is not injected a second time.
    const method = getMethodDescriptor("AddCustomDomain");
    expect(method).toBeDefined();

    const body: Record<string, unknown> = {
      workspace_id: "ws-1",
      static_website_name: "site",
      domain: "example.com",
    };
    const changed = normalizeBodyFieldKeys(body, method!.input.fields);

    expect(changed).toBe(true);
    expect(body).toEqual({
      workspaceId: "ws-1",
      staticWebsiteName: "site",
      domain: "example.com",
    });
    expect("workspace_id" in body).toBe(false);
  });

  test("keeps the canonical key and drops the alias when both forms are present", () => {
    const method = getMethodDescriptor("GetApplication");
    const body: Record<string, unknown> = { workspaceId: "camel", workspace_id: "snake" };

    normalizeBodyFieldKeys(body, method!.input.fields);

    expect(body).toEqual({ workspaceId: "camel" });
  });

  test("leaves keys that are already canonical or unknown untouched", () => {
    const method = getMethodDescriptor("GetApplication");
    const body: Record<string, unknown> = { workspaceId: "ws-1", unknownField: 1 };

    const changed = normalizeBodyFieldKeys(body, method!.input.fields);

    expect(changed).toBe(false);
    expect(body).toEqual({ workspaceId: "ws-1", unknownField: 1 });
  });

  test("uses own-property checks so a field whose localName is a prototype key keeps its value", () => {
    // `toString` lives on Object.prototype; an `in` check would treat the
    // canonical key as already present and drop the alias value rather than
    // moving it. normalizeBodyFieldKeys must use an own-property check.
    const fields = [
      { name: "to_string", jsonName: "toString", localName: "toString" },
    ] as unknown as Parameters<typeof normalizeBodyFieldKeys>[1];
    const body: Record<string, unknown> = { to_string: "kept" };

    const changed = normalizeBodyFieldKeys(body, fields);

    expect(changed).toBe(true);
    expect(Object.hasOwn(body, "toString")).toBe(true);
    expect(body.toString).toBe("kept");
    expect("to_string" in body).toBe(false);
  });
});

describe("api command workspaceId injection (end-to-end body contract)", () => {
  const WS = randomUUID();

  afterEach(() => {
    apiCallMock.mockReset();
    vi.unstubAllEnvs();
  });

  async function sentBody(args: string[]): Promise<Record<string, unknown>> {
    apiCallMock.mockResolvedValue({ status: 200, data: {} });
    using _stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runCommand(apiCommand, args);
    expect(apiCallMock).toHaveBeenCalledTimes(1);
    const opts = apiCallMock.mock.calls[0][0] as { body: string };
    return JSON.parse(opts.body) as Record<string, unknown>;
  }

  test("sends a single workspaceId when --body provides it in snake_case", async () => {
    // The regression: the injection guard missed the snake_case key, appended a
    // second workspaceId, and the server rejected the duplicate field.
    vi.stubEnv("TAILOR_PLATFORM_WORKSPACE_ID", WS);
    const body = await sentBody([
      "AddCustomDomain",
      "-b",
      `{"workspace_id":"${WS}","static_website_name":"s","domain":"d.example.com"}`,
    ]);

    expect(body).toEqual({ workspaceId: WS, staticWebsiteName: "s", domain: "d.example.com" });
    expect("workspace_id" in body).toBe(false);
  });

  test("still injects workspaceId when it is absent from --body", async () => {
    vi.stubEnv("TAILOR_PLATFORM_WORKSPACE_ID", WS);
    const body = await sentBody([
      "AddCustomDomain",
      "-b",
      `{"static_website_name":"s","domain":"d.example.com"}`,
    ]);

    expect(body.workspaceId).toBe(WS);
  });
});
