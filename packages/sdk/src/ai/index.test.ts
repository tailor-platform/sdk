import { describe, expect, expectTypeOf, test, vi } from "vitest";
import {
  createSystemOne,
  SystemOneError,
  type ChoiceResult,
  type SystemOneClient,
  type SystemOneErrorCode,
} from "#/ai/index";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function textResponse(body: string, status: number): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain" } });
}

function answerResponse(answer: unknown): Response {
  return jsonResponse({
    model: "jev-1.13.0",
    answers: { decision: answer },
    usage: { input_tokens: 10, output_tokens: 2 },
  });
}

function gatewayClient(fetchMock: typeof fetch): SystemOneClient {
  return createSystemOne({ baseURL: "https://gateway.example.com", fetch: fetchMock });
}

describe("createSystemOne", () => {
  test("sends a choice question to AI Gateway and preserves literal result types", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      answerResponse({
        type: "choice",
        choice: "billing",
        probabilities: { billing: 0.91, sales: 0.03, support: 0.06 },
        confidence: 0.91,
      }),
    );
    const client = createSystemOne({
      baseURL: "https://gateway.example.com/",
      token: "app-token",
      fetch: fetchMock,
    });

    const result = await client.choice({
      state: { subject: "Charged twice" },
      question: "Which department should handle this ticket?",
      choices: ["billing", "sales", "support"],
    });

    expectTypeOf(result).toEqualTypeOf<ChoiceResult<"billing" | "sales" | "support">>();
    expect(result).toEqual({
      value: "billing",
      probabilities: { billing: 0.91, sales: 0.03, support: 0.06 },
      confidence: 0.91,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://gateway.example.com/v1/systemone");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer app-token");
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "jev-1.13.0",
      state: { subject: "Charged twice" },
      questions: {
        decision: {
          type: "choice",
          instructions: "Which department should handle this ticket?",
          criteria: { billing: null, sales: null, support: null },
        },
      },
    });
  });

  test("sends a boolean question with a model override and omits authorization inside Functions", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(answerResponse({ type: "noul", noul: 0.97 }));
    const client = createSystemOne({
      baseURL: new URL("https://gateway.example.com"),
      fetch: fetchMock,
    });

    const result = await client.boolean({
      state: { invoiceNumber: "INV-1" },
      question: "Is this invoice a duplicate?",
      model: "jev-latest",
    });

    expectTypeOf(result.value).toEqualTypeOf<boolean>();
    expect(result).toEqual({ value: true, probability: 0.97 });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "jev-latest",
      state: { invoiceNumber: "INV-1" },
      questions: {
        decision: { type: "noul", instructions: "Is this invoice a duplicate?" },
      },
    });
  });

  test("returns false with the probability of no when the probability of yes is below 0.5", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(answerResponse({ type: "noul", noul: 0.2 }));

    const result = await gatewayClient(fetchMock).boolean({ state: {}, question: "Continue?" });

    expect(result).toEqual({ value: false, probability: 0.8 });
  });

  test("sends score levels in order and selects the most probable level", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      answerResponse({
        type: "score",
        score: 1.6,
        legend: { "0": "low", "1": "medium", "2": "high" },
        probabilities: { "0": 0.05, "1": 0.3, "2": 0.65 },
        confidence: 0.78,
      }),
    );

    const result = await gatewayClient(fetchMock).score({
      state: { total: 10_000 },
      question: "Assess the risk of this transaction.",
      levels: ["low", "medium", "high"],
    });

    expectTypeOf(result.value).toEqualTypeOf<"low" | "medium" | "high">();
    expect(result).toEqual({
      value: "high",
      probabilities: { low: 0.05, medium: 0.3, high: 0.65 },
      confidence: 0.78,
    });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String(init?.body)).questions).toEqual({
      decision: {
        type: "score",
        instructions: "Assess the risk of this transaction.",
        criteria: ["low", "medium", "high"],
      },
    });
  });

  test("resolves a fresh token for every request", async () => {
    const token = vi
      .fn()
      .mockResolvedValueOnce("first-token")
      .mockResolvedValueOnce("second-token");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => answerResponse({ type: "noul", noul: 0.2 }));
    const client = createSystemOne({
      baseURL: "https://gateway.example.com",
      token,
      fetch: fetchMock,
    });

    await client.boolean({ state: {}, question: "First?" });
    await client.boolean({ state: {}, question: "Second?" });

    expect(token).toHaveBeenCalledTimes(2);
    expect(new Headers(fetchMock.mock.calls[0]![1]?.headers).get("authorization")).toBe(
      "Bearer first-token",
    );
    expect(new Headers(fetchMock.mock.calls[1]![1]?.headers).get("authorization")).toBe(
      "Bearer second-token",
    );
  });

  const routeNotFound =
    "No matching route found. It is likely because the model specified in your request is not configured in the Gateway.";

  test.each<{ status: number; body: unknown; code: SystemOneErrorCode; message: string }>([
    {
      status: 400,
      body: {
        type: "error",
        error: { type: "BadRequest", code: "400", message: "malformed request" },
      },
      code: "INVALID_REQUEST",
      message: "malformed request",
    },
    { status: 401, body: "Unauthorized", code: "UNAUTHORIZED", message: "Unauthorized" },
    { status: 403, body: "Forbidden", code: "UNAUTHORIZED", message: "Forbidden" },
    { status: 404, body: routeNotFound, code: "INVALID_REQUEST", message: routeNotFound },
    { status: 408, body: "Request Timeout", code: "PROVIDER_TIMEOUT", message: "Request Timeout" },
    {
      status: 409,
      body: { detail: "Conflicting request" },
      code: "INVALID_REQUEST",
      message: "Conflicting request",
    },
    {
      status: 413,
      body: "Payload Too Large",
      code: "INVALID_REQUEST",
      message: "Payload Too Large",
    },
    {
      status: 422,
      body: {
        detail: [
          {
            type: "too_short",
            loc: ["body", "questions"],
            msg: "Dictionary should have at least 1 item after validation, not 0",
          },
        ],
      },
      code: "INVALID_REQUEST",
      message: "Dictionary should have at least 1 item after validation, not 0",
    },
    {
      status: 429,
      body: { message: "Too many requests" },
      code: "RATE_LIMITED",
      message: "Too many requests",
    },
    {
      status: 500,
      body: "",
      code: "PROVIDER_UNAVAILABLE",
      message: "System One decision request failed.",
    },
    {
      status: 503,
      body: "Service Unavailable",
      code: "PROVIDER_UNAVAILABLE",
      message: "Service Unavailable",
    },
    { status: 504, body: "Gateway Timeout", code: "PROVIDER_TIMEOUT", message: "Gateway Timeout" },
  ])("maps HTTP $status responses to $code", async ({ status, body, code, message }) => {
    const response =
      typeof body === "string" ? textResponse(body, status) : jsonResponse(body, status);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);

    const promise = gatewayClient(fetchMock).boolean({ state: {}, question: "Continue?" });

    await expect(promise).rejects.toMatchObject({ name: "SystemOneError", code, status, message });
  });

  test.each([
    {
      label: "network failures to an unavailable provider",
      cause: new TypeError("network failed"),
      code: "PROVIDER_UNAVAILABLE",
    },
    {
      label: "fetch timeouts to a provider timeout",
      cause: new DOMException("The operation timed out.", "TimeoutError"),
      code: "PROVIDER_TIMEOUT",
    },
  ])("maps $label", async ({ cause, code }) => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(cause);

    const promise = gatewayClient(fetchMock).boolean({ state: {}, question: "Continue?" });

    await expect(promise).rejects.toEqual(
      expect.objectContaining({ name: "SystemOneError", code, cause }),
    );
  });

  test.each([
    { label: "non-serializable", state: { amount: 1n } },
    { label: "a number", state: 1 },
  ])("reports $label state as an invalid request", async ({ state }) => {
    const fetchMock = vi.fn<typeof fetch>();

    const promise = gatewayClient(fetchMock).boolean({ state, question: "Continue?" });

    await expect(promise).rejects.toMatchObject({
      name: "SystemOneError",
      code: "INVALID_REQUEST",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test.each([
    {
      label: "choices",
      decide: (client: SystemOneClient) =>
        client.choice({
          state: {},
          question: "Which department?",
          choices: ["billing", "billing"],
        }),
    },
    {
      label: "score levels",
      decide: (client: SystemOneClient) =>
        client.score({ state: {}, question: "Assess risk.", levels: ["low", "high", "low"] }),
    },
  ])("rejects duplicate $label before sending the request", async ({ decide }) => {
    const fetchMock = vi.fn<typeof fetch>();

    await expect(decide(gatewayClient(fetchMock))).rejects.toMatchObject({
      name: "SystemOneError",
      code: "INVALID_ANSWER_SPACE",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("rejects values outside the answer space", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      answerResponse({
        type: "choice",
        choice: "legal",
        probabilities: { billing: 0.5, support: 0.5 },
        confidence: 0.5,
      }),
    );

    const promise = gatewayClient(fetchMock).choice({
      state: {},
      question: "Which department?",
      choices: ["billing", "support"],
    });

    await expect(promise).rejects.toBeInstanceOf(SystemOneError);
    await expect(promise).rejects.toMatchObject({ code: "MODEL_ERROR" });
  });

  const decideChoice = (client: SystemOneClient) =>
    client.choice({ state: {}, question: "Which department?", choices: ["billing", "support"] });
  const decideBoolean = (client: SystemOneClient) =>
    client.boolean({ state: {}, question: "Continue?" });
  const decideScore = (client: SystemOneClient) =>
    client.score({ state: {}, question: "Assess risk.", levels: ["low", "medium", "high"] });

  test.each([
    {
      label: "an answer of another question type",
      body: () => answerResponse({ type: "noul", noul: 0.9 }),
      decide: decideScore,
    },
    {
      label: "a choice answer with an invalid probability",
      body: () =>
        answerResponse({
          type: "choice",
          choice: "billing",
          probabilities: { billing: 1.5, support: 0 },
          confidence: 1,
        }),
      decide: decideChoice,
    },
    {
      label: "a choice answer without confidence",
      body: () =>
        answerResponse({
          type: "choice",
          choice: "billing",
          probabilities: { billing: 1, support: 0 },
        }),
      decide: decideChoice,
    },
    {
      label: "a boolean answer without a probability",
      body: () => answerResponse({ type: "noul" }),
      decide: decideBoolean,
    },
    {
      label: "a score answer without every level",
      body: () =>
        answerResponse({
          type: "score",
          score: 0.5,
          probabilities: { "0": 0.5, "1": 0.5 },
          confidence: 0.5,
        }),
      decide: decideScore,
    },
    {
      label: "a response without answers",
      body: () => jsonResponse({ model: "jev-1.13.0" }),
      decide: decideScore,
    },
    {
      label: "a non-JSON response",
      body: () => textResponse("ok", 200),
      decide: decideScore,
    },
  ])("rejects $label as a model error", async ({ body, decide }) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(body());

    await expect(decide(gatewayClient(fetchMock))).rejects.toMatchObject({
      name: "SystemOneError",
      code: "MODEL_ERROR",
    });
  });
});
