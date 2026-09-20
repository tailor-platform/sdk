import { describe, expect, expectTypeOf, test, vi } from "vitest";
import {
  createSystemOne,
  createTypeSafeAITransport,
  SystemOneError,
  type ChoiceResult,
  type SystemOneErrorCode,
} from "#/ai/index";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createSystemOne", () => {
  test("normalizes a choice request and preserves literal result types", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        id: "decision_123",
        result: {
          value: "billing",
          probabilities: { billing: 0.91, sales: 0.03, support: 0.06 },
          confidence: 0.91,
        },
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
    expect(url).toBe("https://gateway.example.com/v1/system-one/evaluate");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer app-token");
    expect(JSON.parse(String(init?.body))).toEqual({
      state: { subject: "Charged twice" },
      question: {
        type: "choice",
        instruction: "Which department should handle this ticket?",
        choices: ["billing", "sales", "support"],
        ordered: false,
      },
    });
  });

  test("normalizes a boolean request and omits authorization inside Functions", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ result: { value: true, confidence: 0.97 } }));
    const client = createSystemOne({
      baseURL: new URL("https://gateway.example.com"),
      fetch: fetchMock,
    });

    const result = await client.boolean({
      state: { invoiceNumber: "INV-1" },
      question: "Is this invoice a duplicate?",
      model: "decision-default",
    });

    expectTypeOf(result.value).toEqualTypeOf<boolean>();
    expect(result).toEqual({ value: true, probability: 0.97 });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "decision-default",
      state: { invoiceNumber: "INV-1" },
      question: {
        type: "boolean",
        instruction: "Is this invoice a duplicate?",
        choices: [true, false],
        ordered: false,
      },
    });
  });

  test("marks score levels as ordered", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        result: {
          value: "high",
          probabilities: { low: 0.03, medium: 0.12, high: 0.85 },
          confidence: 0.85,
        },
      }),
    );
    const client = createSystemOne({ baseURL: "https://gateway.example.com", fetch: fetchMock });

    const result = await client.score({
      state: { total: 10_000 },
      question: "Assess the risk of this transaction.",
      levels: ["low", "medium", "high"],
    });

    expectTypeOf(result.value).toEqualTypeOf<"low" | "medium" | "high">();
    expect(result.value).toBe("high");
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String(init?.body)).question).toEqual({
      type: "score",
      instruction: "Assess the risk of this transaction.",
      choices: ["low", "medium", "high"],
      ordered: true,
    });
  });

  test("resolves a fresh token for every request", async () => {
    const token = vi
      .fn()
      .mockResolvedValueOnce("first-token")
      .mockResolvedValueOnce("second-token");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => jsonResponse({ result: { value: false, probability: 0.8 } }));
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

  test("throws normalized gateway errors", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ error: { code: "RATE_LIMITED", message: "Decision limit exceeded." } }, 429),
      );
    const client = createSystemOne({ baseURL: "https://gateway.example.com", fetch: fetchMock });

    const promise = client.boolean({ state: {}, question: "Continue?" });

    await expect(promise).rejects.toMatchObject({
      name: "SystemOneError",
      code: "RATE_LIMITED" satisfies SystemOneErrorCode,
      status: 429,
      message: "Decision limit exceeded.",
    });
  });

  test("maps transport failures without exposing provider details", async () => {
    const cause = new TypeError("network failed");
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(cause);
    const client = createSystemOne({ baseURL: "https://gateway.example.com", fetch: fetchMock });

    const promise = client.boolean({ state: {}, question: "Continue?" });

    await expect(promise).rejects.toEqual(
      expect.objectContaining({
        name: "SystemOneError",
        code: "PROVIDER_UNAVAILABLE",
        cause,
      }),
    );
  });

  test("reports non-serializable state as an invalid request", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = createSystemOne({ baseURL: "https://gateway.example.com", fetch: fetchMock });

    const promise = client.boolean({ state: { amount: 1n }, question: "Continue?" });

    await expect(promise).rejects.toMatchObject({
      name: "SystemOneError",
      code: "INVALID_REQUEST",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("rejects values outside the answer space", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        result: {
          value: "legal",
          probabilities: { billing: 0.5, support: 0.5 },
          confidence: 0.5,
        },
      }),
    );
    const client = createSystemOne({ baseURL: "https://gateway.example.com", fetch: fetchMock });

    const promise = client.choice({
      state: {},
      question: "Which department?",
      choices: ["billing", "support"],
    });

    await expect(promise).rejects.toBeInstanceOf(SystemOneError);
    await expect(promise).rejects.toMatchObject({ code: "MODEL_ERROR" });
  });

  test("uses an explicitly configured TypeSafe AI transport", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        model: "jev-latest",
        answers: {
          decision: {
            type: "choice",
            choice: "billing",
            probabilities: { billing: 0.91, sales: 0.09 },
            confidence: 0.88,
          },
        },
        usage: { input_tokens: 10, output_tokens: 2 },
      }),
    );
    const client = createSystemOne({
      transport: createTypeSafeAITransport({
        apiKey: "typesafe-token",
        fetch: fetchMock,
        retry: { maxRetries: 0 },
      }),
    });

    const result = await client.choice({
      state: { subject: "Charged twice" },
      question: "Which department should handle this ticket?",
      choices: ["billing", "sales"],
    });

    expect(result).toEqual({
      value: "billing",
      probabilities: { billing: 0.91, sales: 0.09 },
      confidence: 0.88,
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer typesafe-token");
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "jev-latest",
      state: { subject: "Charged twice" },
      questions: {
        decision: {
          type: "choice",
          instructions: "Which department should handle this ticket?",
          criteria: { billing: null, sales: null },
        },
      },
    });
  });

  test("normalizes TypeSafe AI boolean probabilities", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        model: "jev-latest",
        answers: { decision: { type: "noul", noul: 0.2 } },
        usage: { input_tokens: 8, output_tokens: 1 },
      }),
    );
    const client = createSystemOne({
      transport: createTypeSafeAITransport({
        apiKey: "typesafe-token",
        fetch: fetchMock,
        retry: { maxRetries: 0 },
      }),
    });

    const result = await client.boolean({ state: {}, question: "Continue?" });

    expect(result).toEqual({ value: false, probability: 0.8 });
  });

  test("maps TypeSafe AI score probabilities to named levels", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        model: "jev-latest",
        answers: {
          decision: {
            type: "score",
            score: 1.6,
            legend: { "0": "low", "1": "medium", "2": "high" },
            probabilities: { "0": 0.05, "1": 0.3, "2": 0.65 },
            confidence: 0.78,
          },
        },
        usage: { input_tokens: 12, output_tokens: 2 },
      }),
    );
    const client = createSystemOne({
      transport: createTypeSafeAITransport({
        apiKey: "typesafe-token",
        fetch: fetchMock,
        retry: { maxRetries: 0 },
      }),
    });

    const result = await client.score({
      state: {},
      question: "Assess risk.",
      levels: ["low", "medium", "high"],
    });

    expect(result).toEqual({
      value: "high",
      probabilities: { low: 0.05, medium: 0.3, high: 0.65 },
      confidence: 0.78,
    });
  });

  test("normalizes TypeSafe AI rate limit errors", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ message: "Too many requests" }, 429));
    const client = createSystemOne({
      transport: createTypeSafeAITransport({
        apiKey: "typesafe-token",
        fetch: fetchMock,
        retry: { maxRetries: 0 },
      }),
    });

    const promise = client.boolean({ state: {}, question: "Continue?" });

    await expect(promise).rejects.toMatchObject({
      name: "SystemOneError",
      code: "RATE_LIMITED",
      status: 429,
    });
  });
});
