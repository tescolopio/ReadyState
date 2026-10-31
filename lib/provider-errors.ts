import { APICallError, RetryError, StreamProviderError } from "ai";

import type { AppMode } from "@/lib/config";

/** What a provider failure says, whether it failed the request or arrived mid-stream. */
interface ProviderFailure {
  status?: number;
  text: string;
  headers?: Record<string, string>;
}

/** The provider's error, unwrapped from the SDK's retry wrapper and causes. */
const providerFailure = (error: unknown): ProviderFailure | undefined => {
  if (APICallError.isInstance(error)) {
    return { status: error.statusCode, text: `${error.message} ${error.responseBody ?? ""}`, headers: error.responseHeaders };
  }
  if (StreamProviderError.isInstance(error)) {
    return { status: error.statusCode, text: `${error.message} ${error.code ?? ""}` };
  }
  if (RetryError.isInstance(error)) return providerFailure(error.lastError);
  if (error instanceof Error && error.cause) return providerFailure(error.cause);
  return undefined;
};

/** "4m35.616s", "12s" or "277.5ms" from a provider message, in seconds. */
export function retryAfterSeconds(error: unknown): number | undefined {
  const failure = providerFailure(error);
  if (!failure) return undefined;
  const retryAfter = Number(failure.headers?.["retry-after"]);
  const ms = failure.text.match(/try again in ([\d.]+)ms/i);
  const match = failure.text.match(/try again in (?:(\d+)h)?(?:(\d+)m(?!s))?(?:([\d.]+)s)?/i);
  const seconds = ms
    ? Number(ms[1]) / 1000
    : match?.slice(1).some(Boolean)
      ? Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0)
      : retryAfter;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

/** A wait rounded up for people. */
const waitFor = (error: unknown) => {
  const seconds = retryAfterSeconds(error);
  if (!seconds) return "a little while";
  if (seconds < 5) return "a few seconds";
  if (seconds < 90) return `about ${Math.ceil(seconds)} seconds`;
  if (seconds < 5400) return `about ${Math.ceil(seconds / 60)} minutes`;
  return `about ${Math.ceil(seconds / 3600)} hours`;
};

/** True when the request's time budget ran out (an AbortSignal timeout), possibly wrapped by the SDK. */
const timedOut = (error: unknown): boolean =>
  error instanceof Error || error instanceof DOMException
    ? error.name === "TimeoutError" || ("cause" in error && timedOut(error.cause)) || (RetryError.isInstance(error) && timedOut(error.lastError))
    : false;

/**
 * True when the provider rejected the model's tool call for not matching the
 * schema, such as a missing field or `feedback.why` sent as an array (eval
 * findings 6 and 8). The same request usually succeeds on a second try.
 */
export function isSchemaSlip(error: unknown): boolean {
  const failure = providerFailure(error);
  return Boolean(failure && /tool_use_failed|tool call validation failed|did not match schema/i.test(failure.text));
}

/**
 * The provider's error code and, for a rejected tool call, the generation it
 * rejected, for eval diagnostics. Callers must not store or print the
 * generation; the message text, which can carry account details, isn't
 * returned at all.
 */
export function providerErrorDetails(error: unknown): { code?: string; failedGeneration?: string } {
  const unwrap = (e: unknown): unknown => (RetryError.isInstance(e) ? unwrap(e.lastError) : e instanceof Error && e.cause && !APICallError.isInstance(e) ? unwrap(e.cause) : e);
  const inner = unwrap(error);
  if (!APICallError.isInstance(inner) || !inner.responseBody) return {};
  try {
    const body = JSON.parse(inner.responseBody) as { error?: { code?: unknown; failed_generation?: unknown } };
    return {
      code: typeof body.error?.code === "string" ? body.error.code : undefined,
      failedGeneration: typeof body.error?.failed_generation === "string" ? body.error.failed_generation : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * A provider failure's status and kind, without any of its text, for eval
 * logs: the raw text can carry account or organization details.
 */
export function failureSummary(error: unknown): string {
  const failure = providerFailure(error);
  if (!failure) return error instanceof Error ? error.name : "unknown error";
  const kind = isSchemaSlip(error)
    ? "malformed tool call"
    : failure.status === 429
      ? "rate limit"
      : failure.status === 413 || /request too large|reduce your message size/i.test(failure.text)
        ? "request too large"
        : /context length|maximum context/i.test(failure.text)
          ? "context too long"
          : "other";
  return `status ${failure.status ?? "unknown"}, ${kind}`;
}

/**
 * Turns a model-provider failure into a message the participant can act on
 * (work item G4). Never includes the provider's raw error text, which can
 * carry account or organization details.
 */
export function describeProviderError(error: unknown, mode: AppMode): string {
  const settingsHint = mode === "self-hosted" ? " or choose another model or provider in Settings" : "";
  if (timedOut(error)) {
    return "The model took too long to respond, so ReadyState stopped waiting before the server's time limit. Your exercise is still here; submit again in a minute.";
  }
  const failure = providerFailure(error);
  if (!failure) return "Something went wrong generating this turn. Please try again.";

  const status = failure.status;
  const text = failure.text.toLowerCase();
  if (status === 429) {
    const daily = /per day|tpd|rpd|daily/.test(text);
    return daily
      ? `The model provider's daily usage limit has been reached. Try again in ${waitFor(error)}${settingsHint}.`
      : `The model provider is limiting requests right now. Wait ${waitFor(error)} and submit again.`;
  }
  if (status === 401 || status === 403) {
    return mode === "self-hosted"
      ? "The model provider rejected the API key. Check it in Settings or the server's .env.local."
      : "The service couldn't reach its model provider. Please try again later.";
  }
  if (isSchemaSlip(error)) {
    return `The model returned an incomplete turn. Submit your response again${settingsHint ? `; if it keeps happening, choose a larger model in Settings` : ""}.`;
  }
  if (status === 404) return `The model provider doesn't recognize the selected model${settingsHint ? `; choose another in Settings` : ""}.`;
  if (status !== undefined && status >= 500) return "The model provider is having problems. Please try again shortly.";
  return "The model provider returned an error. Please try again.";
}
