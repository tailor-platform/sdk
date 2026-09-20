/**
 * Client for semantic decisions through Tailor AI Gateway or a custom transport.
 *
 * @example
 * import { createSystemOne } from "@tailor-platform/sdk/ai";
 *
 * const systemOne = createSystemOne({
 *   baseURL: "https://my-aigateway.example.com",
 *   token: applicationUserToken,
 * });
 *
 * const decision = await systemOne.choice({
 *   state: { subject: "Charged twice" },
 *   question: "Which department should handle this ticket?",
 *   choices: ["billing", "sales", "support"],
 * });
 */

import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  BadRequestError,
  choice as typeSafeChoice,
  InternalServerError,
  noul as typeSafeNoul,
  RateLimitError,
  score as typeSafeScore,
  TypeSafeClient,
  UnprocessableEntityError,
  type EntryType,
  type RetryPolicy,
} from "@typesafe-ai/sdk";

/** Error codes returned for System One decisions. */
export type SystemOneErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_ANSWER_SPACE"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_TIMEOUT"
  | "RATE_LIMITED"
  | "MODEL_ERROR";

/** Error returned when a System One decision cannot be completed. */
export class SystemOneError extends Error {
  /** Stable, provider-independent error code. */
  readonly code: SystemOneErrorCode;

  /** HTTP status returned by the selected transport, when available. */
  readonly status?: number;

  /**
   * Create a System One error.
   * @param message - Human-readable error message
   * @param code - Stable error code
   * @param options - Additional error details
   */
  constructor(
    message: string,
    code: SystemOneErrorCode,
    options: ErrorOptions & { status?: number } = {},
  ) {
    super(message, options);
    this.name = "SystemOneError";
    this.code = code;
    this.status = options.status;
  }
}

/** Options used to connect a System One client to Tailor AI Gateway. */
export interface AIGatewaySystemOneOptions {
  /** AI Gateway base URL. */
  baseURL: string | URL;
  /** Application user token. Omit this inside a Tailor Function. */
  token?: string | (() => string | Promise<string>);
  /** Custom Fetch implementation. */
  fetch?: typeof globalThis.fetch;
  /** Use the default AI Gateway transport. */
  transport?: undefined;
}

/** Options used to create a System One client with a custom transport. */
export interface CustomSystemOneTransportOptions {
  /** Transport used to evaluate System One decisions. */
  transport: SystemOneTransport;
  /** AI Gateway options cannot be combined with a custom transport. */
  baseURL?: never;
  /** AI Gateway options cannot be combined with a custom transport. */
  token?: never;
  /** AI Gateway options cannot be combined with a custom transport. */
  fetch?: never;
}

/** Options used to create a System One client. */
export type CreateSystemOneOptions = AIGatewaySystemOneOptions | CustomSystemOneTransportOptions;

/** Options used to connect directly to TypeSafe AI. */
export interface TypeSafeAITransportOptions {
  /** TypeSafe AI API key. */
  apiKey: string;
  /** TypeSafe AI API root. */
  baseURL?: string;
  /** Model used when a decision does not specify one. */
  defaultModel?: string;
  /** Request timeout per attempt in milliseconds. */
  timeout?: number;
  /** Retry policy overrides. */
  retry?: Partial<RetryPolicy>;
  /** Custom Fetch implementation. */
  fetch?: typeof globalThis.fetch;
}

/** Common input shared by all System One decisions. */
export interface SystemOneInput {
  /** Data used to make the decision. */
  state: unknown;
  /** Natural-language question to answer. */
  question: string;
  /** Optional decision model override. */
  model?: string;
}

/** Input for a choice decision. */
export interface ChoiceInput<
  Choices extends readonly [string, ...string[]],
> extends SystemOneInput {
  /** Allowed answers. */
  choices: Choices;
}

/** Result of a choice or score decision. */
export interface ChoiceResult<Value extends string> {
  /** Selected answer. */
  value: Value;
  /** Probability for every allowed answer. */
  probabilities: Record<Value, number>;
  /** Provider-reported confidence in the selected answer. */
  confidence: number;
}

/** Input for a boolean decision. */
export type BooleanInput = SystemOneInput;

/** Result of a boolean decision. */
export interface BooleanResult {
  /** Selected boolean answer. */
  value: boolean;
  /** Probability assigned to the selected answer. */
  probability: number;
}

/** Input for an ordered score decision. */
export interface ScoreInput<
  Levels extends readonly [string, string, ...string[]],
> extends SystemOneInput {
  /** Ordered score levels, from lowest to highest. */
  levels: Levels;
}

/** System One semantic decision client. */
export interface SystemOneClient {
  /**
   * Select one value from an answer space.
   * @param input - State, question, and allowed choices
   * @returns The selected value and its probability distribution
   */
  choice<const Choices extends readonly [string, ...string[]]>(
    input: ChoiceInput<Choices>,
  ): Promise<ChoiceResult<Choices[number]>>;

  /**
   * Answer a binary question.
   * @param input - State and question
   * @returns The boolean answer and its probability
   */
  boolean(input: BooleanInput): Promise<BooleanResult>;

  /**
   * Select one value from an ordered answer space.
   * @param input - State, question, and ordered score levels
   * @returns The selected level and its probability distribution
   */
  score<const Levels extends readonly [string, string, ...string[]]>(
    input: ScoreInput<Levels>,
  ): Promise<ChoiceResult<Levels[number]>>;
}

type DecisionType = "boolean" | "choice" | "score";

/** Normalized request passed to a System One transport. */
export interface SystemOneTransportRequest {
  model?: string;
  state: unknown;
  question: {
    type: DecisionType;
    instruction: string;
    choices: readonly (string | boolean)[];
    ordered: boolean;
  };
}

/** Normalized result returned by a System One transport. */
export interface SystemOneTransportResult {
  value?: unknown;
  probabilities?: unknown;
  confidence?: unknown;
  probability?: unknown;
}

/** Transport used by a System One client to evaluate decisions. */
export interface SystemOneTransport {
  /** Evaluate a normalized System One request. */
  evaluate(request: SystemOneTransportRequest): Promise<SystemOneTransportResult>;
}

const errorCodes = new Set<SystemOneErrorCode>([
  "INVALID_REQUEST",
  "INVALID_ANSWER_SPACE",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_TIMEOUT",
  "RATE_LIMITED",
  "MODEL_ERROR",
]);

function endpoint(baseURL: string | URL): string {
  return `${String(baseURL).replace(/\/+$/, "")}/v1/system-one/evaluate`;
}

async function resolveToken(
  token: AIGatewaySystemOneOptions["token"],
): Promise<string | undefined> {
  return typeof token === "function" ? token() : token;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function isProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function invalidResponse(message: string): SystemOneError {
  return new SystemOneError(message, "MODEL_ERROR");
}

function parseChoiceResult<Choices extends readonly [string, ...string[]]>(
  result: SystemOneTransportResult,
  choices: Choices,
): ChoiceResult<Choices[number]> {
  if (typeof result.value !== "string" || !choices.includes(result.value)) {
    throw invalidResponse("System One returned a value outside the requested answer space.");
  }

  const rawProbabilities = asObject(result.probabilities);
  if (!rawProbabilities) {
    throw invalidResponse("System One returned an invalid probability distribution.");
  }

  const probabilities = Object.fromEntries(
    choices.map((choice) => {
      const probability = rawProbabilities[choice];
      if (!isProbability(probability)) {
        throw invalidResponse(`System One returned an invalid probability for "${choice}".`);
      }
      return [choice, probability];
    }),
  ) as Record<Choices[number], number>;

  if (!isProbability(result.confidence)) {
    throw invalidResponse("System One returned an invalid confidence value.");
  }

  return {
    value: result.value,
    probabilities,
    confidence: result.confidence,
  };
}

function parseBooleanResult(result: SystemOneTransportResult): BooleanResult {
  if (typeof result.value !== "boolean") {
    throw invalidResponse("System One returned a non-boolean value for a boolean decision.");
  }

  const probability = result.probability ?? result.confidence;
  if (!isProbability(probability)) {
    throw invalidResponse("System One returned an invalid probability.");
  }

  return { value: result.value, probability };
}

function parseErrorPayload(payload: unknown): { code: SystemOneErrorCode; message: string } {
  const root = asObject(payload);
  const details = asObject(root?.error) ?? root;
  const rawCode = details?.code;
  const code =
    typeof rawCode === "string" && errorCodes.has(rawCode as SystemOneErrorCode)
      ? (rawCode as SystemOneErrorCode)
      : "MODEL_ERROR";
  const message =
    typeof details?.message === "string" ? details.message : "System One decision request failed.";
  return { code, message };
}

async function readJSON(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (cause) {
    throw new SystemOneError("AI Gateway returned an invalid JSON response.", "MODEL_ERROR", {
      cause,
      status: response.status,
    });
  }
}

function createAIGatewayTransport(options: AIGatewaySystemOneOptions): SystemOneTransport {
  const fetchImplementation = options.fetch ?? globalThis.fetch;

  return {
    async evaluate(request) {
      let body: string;
      try {
        body = JSON.stringify(request);
      } catch (cause) {
        throw new SystemOneError("System One input must be JSON-serializable.", "INVALID_REQUEST", {
          cause,
        });
      }

      const token = await resolveToken(options.token);
      const headers = new Headers({ "content-type": "application/json" });
      if (token) {
        headers.set("authorization", `Bearer ${token}`);
      }

      let response: Response;
      try {
        response = await fetchImplementation(endpoint(options.baseURL), {
          method: "POST",
          headers,
          body,
        });
      } catch (cause) {
        throw new SystemOneError("Unable to reach AI Gateway.", "PROVIDER_UNAVAILABLE", { cause });
      }

      const payload = await readJSON(response);
      if (!response.ok) {
        const error = parseErrorPayload(payload);
        throw new SystemOneError(error.message, error.code, { status: response.status });
      }

      const result = asObject(asObject(payload)?.result);
      if (!result) {
        throw invalidResponse("AI Gateway response did not contain a decision result.");
      }
      return result;
    },
  };
}

function mapTypeSafeError(error: unknown): SystemOneError {
  if (error instanceof SystemOneError) {
    return error;
  }
  if (error instanceof RateLimitError) {
    return new SystemOneError("System One request was rate limited.", "RATE_LIMITED", {
      cause: error,
      status: error.status,
    });
  }
  if (error instanceof APITimeoutError) {
    return new SystemOneError("System One provider timed out.", "PROVIDER_TIMEOUT", {
      cause: error,
    });
  }
  if (error instanceof APIConnectionError) {
    return new SystemOneError("Unable to reach the System One provider.", "PROVIDER_UNAVAILABLE", {
      cause: error,
    });
  }
  if (error instanceof BadRequestError || error instanceof UnprocessableEntityError) {
    return new SystemOneError("The System One provider rejected the request.", "INVALID_REQUEST", {
      cause: error,
      status: error.status,
    });
  }
  if (error instanceof InternalServerError) {
    return new SystemOneError("The System One provider is unavailable.", "PROVIDER_UNAVAILABLE", {
      cause: error,
      status: error.status,
    });
  }
  if (error instanceof APIError) {
    return new SystemOneError("The System One provider returned an error.", "MODEL_ERROR", {
      cause: error,
      status: error.status,
    });
  }
  return new SystemOneError("The System One provider returned an error.", "MODEL_ERROR", {
    cause: error,
  });
}

function highestProbabilityIndex(probabilities: Readonly<Record<string, number>>): number {
  let selectedIndex = -1;
  let selectedProbability = -1;
  for (const [index, probability] of Object.entries(probabilities)) {
    if (probability > selectedProbability) {
      selectedIndex = Number(index);
      selectedProbability = probability;
    }
  }
  return selectedIndex;
}

function toTypeSafeState(state: unknown): EntryType {
  try {
    const serialized = JSON.stringify(state) as string | undefined;
    if (serialized === undefined) {
      throw new TypeError("State is not JSON-serializable.");
    }
    const value: unknown = JSON.parse(serialized);
    if (typeof value === "string" || value === null || typeof value === "object") {
      return value as EntryType;
    }
  } catch (cause) {
    throw new SystemOneError(
      "System One state must be a JSON object, array, string, or null.",
      "INVALID_REQUEST",
      {
        cause,
      },
    );
  }
  throw new SystemOneError(
    "System One state must be a JSON object, array, string, or null.",
    "INVALID_REQUEST",
  );
}

/**
 * Create a transport that calls TypeSafe AI directly.
 * @param options - TypeSafe AI connection options
 * @returns A System One transport
 */
export function createTypeSafeAITransport(options: TypeSafeAITransportOptions): SystemOneTransport {
  const client = new TypeSafeClient({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    defaultModel: options.defaultModel,
    timeout: options.timeout,
    retry: options.retry,
    fetch: options.fetch,
  });

  return {
    async evaluate(request) {
      try {
        const state = toTypeSafeState(request.state);
        if (request.question.type === "choice") {
          const criteria = Object.fromEntries(
            request.question.choices.map((value) => [String(value), null]),
          );
          const response = await client.systemOne({
            state,
            model: request.model,
            questions: {
              decision: typeSafeChoice(request.question.instruction, criteria),
            },
          });
          const answer = response.answers.decision;
          return {
            value: answer.choice,
            probabilities: answer.probabilities,
            confidence: answer.confidence,
          };
        }

        if (request.question.type === "boolean") {
          const response = await client.systemOne({
            state,
            model: request.model,
            questions: { decision: typeSafeNoul(request.question.instruction) },
          });
          const yesProbability = response.answers.decision.noul;
          const value = yesProbability >= 0.5;
          return {
            value,
            probability: value ? yesProbability : 1 - yesProbability,
          };
        }

        const levels = request.question.choices.map(String) as [string, string, ...string[]];
        const response = await client.systemOne({
          state,
          model: request.model,
          questions: {
            decision: typeSafeScore(request.question.instruction, levels),
          },
        });
        const answer = response.answers.decision;
        const selectedIndex = highestProbabilityIndex(answer.probabilities);
        return {
          value: levels[selectedIndex],
          probabilities: Object.fromEntries(
            levels.map((level, index) => [level, answer.probabilities[index]]),
          ),
          confidence: answer.confidence,
        };
      } catch (error) {
        throw mapTypeSafeError(error);
      }
    },
  };
}

/**
 * Create a provider-independent System One client.
 * @param options - Transport or AI Gateway connection options
 * @returns A semantic decision client
 */
export function createSystemOne(options: CreateSystemOneOptions): SystemOneClient {
  const transport = options.transport ?? createAIGatewayTransport(options);

  const choice: SystemOneClient["choice"] = async (input) => {
    const result = await transport.evaluate({
      model: input.model,
      state: input.state,
      question: {
        type: "choice",
        instruction: input.question,
        choices: input.choices,
        ordered: false,
      },
    });
    return parseChoiceResult(result, input.choices);
  };

  const boolean: SystemOneClient["boolean"] = async (input) => {
    const result = await transport.evaluate({
      model: input.model,
      state: input.state,
      question: {
        type: "boolean",
        instruction: input.question,
        choices: [true, false],
        ordered: false,
      },
    });
    return parseBooleanResult(result);
  };

  const score: SystemOneClient["score"] = async (input) => {
    const result = await transport.evaluate({
      model: input.model,
      state: input.state,
      question: {
        type: "score",
        instruction: input.question,
        choices: input.levels,
        ordered: true,
      },
    });
    return parseChoiceResult(result, input.levels);
  };

  return { choice, boolean, score };
}
