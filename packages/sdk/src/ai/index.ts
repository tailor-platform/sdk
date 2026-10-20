/**
 * Client for semantic decisions through Tailor AI Gateway.
 *
 * @example
 * import { createSystemOne } from "@tailor-platform/sdk/ai";
 *
 * const systemOne = createSystemOne({
 *   baseURL: "https://my-aigateway.example.com",
 *   token: accessToken,
 * });
 *
 * const decision = await systemOne.choice({
 *   state: { subject: "Charged twice" },
 *   question: "Which department should handle this ticket?",
 *   choices: ["billing", "sales", "support"],
 * });
 */

/** Error codes returned for System One decisions. */
export type SystemOneErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_ANSWER_SPACE"
  | "UNAUTHORIZED"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_TIMEOUT"
  | "RATE_LIMITED"
  | "MODEL_ERROR";

/** Error returned when a System One decision cannot be completed. */
export class SystemOneError extends Error {
  /** Stable, provider-independent error code. */
  readonly code: SystemOneErrorCode;

  /** HTTP status returned by AI Gateway, when available. */
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
export interface CreateSystemOneOptions {
  /** AI Gateway base URL. */
  baseURL: string | URL;
  /** Access token issued by the AI Gateway's auth namespace. Omit this inside a Tailor Function. */
  token?: string | (() => string | Promise<string>);
  /** Custom Fetch implementation. */
  fetch?: typeof globalThis.fetch;
}

/** Common input shared by all System One decisions. */
export interface SystemOneInput {
  /** Data used to make the decision: a JSON object, array, string, or `null`. */
  state: unknown;
  /** Natural-language question to answer. */
  question: string;
  /** Decision model. Defaults to `jev-1.13.0`. */
  model?: string;
}

/** Input for a choice decision. */
export interface ChoiceInput<
  Choices extends readonly [string, ...string[]],
> extends SystemOneInput {
  /** Allowed answers. Each value must be unique. */
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
  /** `true` when the probability of "yes" is at least 0.5. */
  value: boolean;
  /** Probability assigned to the selected answer. */
  probability: number;
}

/** Input for an ordered score decision. */
export interface ScoreInput<
  Levels extends readonly [string, string, ...string[]],
> extends SystemOneInput {
  /** Ordered score levels, from lowest to highest. Each level must be unique. */
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
   * Select one value from an ordered answer space. The level with the highest probability is selected.
   * @param input - State, question, and ordered score levels
   * @returns The selected level and its probability distribution
   */
  score<const Levels extends readonly [string, string, ...string[]]>(
    input: ScoreInput<Levels>,
  ): Promise<ChoiceResult<Levels[number]>>;
}

type DecisionQuestion =
  | { type: "noul"; instructions: string }
  | { type: "choice"; instructions: string; criteria: Record<string, null> }
  | { type: "score"; instructions: string; criteria: readonly string[] };

type DecisionAnswer = Record<string, unknown>;

const defaultModel = "jev-1.13.0";

function endpoint(baseURL: string | URL): string {
  return `${String(baseURL).replace(/\/+$/, "")}/v1/systemone`;
}

async function resolveToken(token: CreateSystemOneOptions["token"]): Promise<string | undefined> {
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

function assertUniqueAnswers(values: readonly string[]): void {
  if (new Set(values).size !== values.length) {
    throw new SystemOneError("System One answer values must be unique.", "INVALID_ANSWER_SPACE");
  }
}

function invalidState(options?: ErrorOptions): SystemOneError {
  return new SystemOneError(
    "System One state must be a JSON object, array, string, or null.",
    "INVALID_REQUEST",
    options,
  );
}

function toDecisionState(state: unknown): unknown {
  let value: unknown;
  try {
    const serialized = JSON.stringify(state) as string | undefined;
    value = serialized === undefined ? undefined : JSON.parse(serialized);
  } catch (cause) {
    throw invalidState({ cause });
  }
  if (typeof value !== "string" && typeof value !== "object") {
    throw invalidState();
  }
  return value;
}

function errorCode(status: number): SystemOneErrorCode {
  if (status === 401 || status === 403) {
    return "UNAUTHORIZED";
  }
  if (status === 408 || status === 504) {
    return "PROVIDER_TIMEOUT";
  }
  if (status === 429) {
    return "RATE_LIMITED";
  }
  if (status >= 500) {
    return "PROVIDER_UNAVAILABLE";
  }
  if (status >= 400) {
    return "INVALID_REQUEST";
  }
  return "MODEL_ERROR";
}

function errorMessage(payload: unknown): string | undefined {
  if (typeof payload === "string") {
    return payload.trim() || undefined;
  }
  const root = asObject(payload);
  const nested = asObject(root?.error)?.message;
  if (typeof nested === "string") {
    return nested;
  }
  if (typeof root?.message === "string") {
    return root.message;
  }
  if (typeof root?.detail === "string") {
    return root.detail;
  }
  if (Array.isArray(root?.detail)) {
    const messages = root.detail
      .map((detail) => asObject(detail)?.msg)
      .filter((message) => typeof message === "string");
    return messages.length > 0 ? messages.join("; ") : undefined;
  }
  return undefined;
}

async function readErrorMessage(response: Response): Promise<string | undefined> {
  const text = await response.text().catch(() => "");
  try {
    return errorMessage(JSON.parse(text));
  } catch {
    return errorMessage(text);
  }
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

async function evaluate(
  options: CreateSystemOneOptions,
  input: SystemOneInput,
  question: DecisionQuestion,
): Promise<DecisionAnswer> {
  const body = JSON.stringify({
    model: input.model ?? defaultModel,
    state: toDecisionState(input.state),
    questions: { decision: question },
  });

  const token = await resolveToken(options.token);
  const headers = new Headers({ "content-type": "application/json" });
  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }

  const fetchImplementation = options.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    response = await fetchImplementation(endpoint(options.baseURL), {
      method: "POST",
      headers,
      body,
    });
  } catch (cause) {
    if (cause instanceof Error && cause.name === "TimeoutError") {
      throw new SystemOneError("AI Gateway request timed out.", "PROVIDER_TIMEOUT", { cause });
    }
    throw new SystemOneError("Unable to reach AI Gateway.", "PROVIDER_UNAVAILABLE", { cause });
  }

  if (!response.ok) {
    const message = (await readErrorMessage(response)) ?? "System One decision request failed.";
    throw new SystemOneError(message, errorCode(response.status), { status: response.status });
  }

  const answer = asObject(asObject(asObject(await readJSON(response))?.answers)?.decision);
  if (answer?.type !== question.type) {
    throw invalidResponse("AI Gateway response did not contain a decision answer.");
  }
  return answer;
}

function parseChoiceAnswer<Choices extends readonly [string, ...string[]]>(
  answer: DecisionAnswer,
  choices: Choices,
): ChoiceResult<Choices[number]> {
  if (typeof answer.choice !== "string" || !choices.includes(answer.choice)) {
    throw invalidResponse("System One returned a value outside the requested answer space.");
  }

  const rawProbabilities = asObject(answer.probabilities);
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

  if (!isProbability(answer.confidence)) {
    throw invalidResponse("System One returned an invalid confidence value.");
  }

  return { value: answer.choice, probabilities, confidence: answer.confidence };
}

function parseBooleanAnswer(answer: DecisionAnswer): BooleanResult {
  if (!isProbability(answer.noul)) {
    throw invalidResponse("System One returned an invalid probability.");
  }
  const value = answer.noul >= 0.5;
  return { value, probability: value ? answer.noul : 1 - answer.noul };
}

function parseScoreAnswer<Levels extends readonly [string, string, ...string[]]>(
  answer: DecisionAnswer,
  levels: Levels,
): ChoiceResult<Levels[number]> {
  const rawProbabilities = asObject(answer.probabilities);
  if (!rawProbabilities) {
    throw invalidResponse("System One returned an invalid probability distribution.");
  }

  const scores = levels.map((level, index) => {
    const probability = rawProbabilities[String(index)];
    if (!isProbability(probability)) {
      throw invalidResponse(`System One returned an invalid probability for "${level}".`);
    }
    return { level, probability };
  });

  if (!isProbability(answer.confidence)) {
    throw invalidResponse("System One returned an invalid confidence value.");
  }

  return {
    value: scores.reduce((selected, score) =>
      score.probability > selected.probability ? score : selected,
    ).level,
    probabilities: Object.fromEntries(
      scores.map(({ level, probability }) => [level, probability]),
    ) as Record<Levels[number], number>,
    confidence: answer.confidence,
  };
}

/**
 * Create a System One client that makes decisions through Tailor AI Gateway.
 * @param options - AI Gateway connection options
 * @returns A semantic decision client
 */
export function createSystemOne(options: CreateSystemOneOptions): SystemOneClient {
  const choice: SystemOneClient["choice"] = async (input) => {
    assertUniqueAnswers(input.choices);
    const answer = await evaluate(options, input, {
      type: "choice",
      instructions: input.question,
      criteria: Object.fromEntries(input.choices.map((value) => [value, null])),
    });
    return parseChoiceAnswer(answer, input.choices);
  };

  const boolean: SystemOneClient["boolean"] = async (input) => {
    const answer = await evaluate(options, input, {
      type: "noul",
      instructions: input.question,
    });
    return parseBooleanAnswer(answer);
  };

  const score: SystemOneClient["score"] = async (input) => {
    assertUniqueAnswers(input.levels);
    const answer = await evaluate(options, input, {
      type: "score",
      instructions: input.question,
      criteria: input.levels,
    });
    return parseScoreAnswer(answer, input.levels);
  };

  return { choice, boolean, score };
}
