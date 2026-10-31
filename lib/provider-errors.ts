import { APICallError, RetryError } from "ai";

import type { AppMode } from "@/lib/config";

/** The provider's HTTP error, unwrapped from the SDK's retry wrapper. */
const apiError = (error: unknown): APICallError | undefined => {
  if (APICallError.isInstance(error)) return error;
  if (RetryError.isInstance(error)) return apiError(error.lastError);
  if (error instanceof Error && error.cause) return apiError(error.cause);
  return undefined;
};

/** "4m35.616s", "12s" or "277.5ms" from a provider message, in seconds; else the Retry-After header. */
export function retryAfterSeconds(error: APICallError): number | undefined {
  const retryAfter = Number(error.responseHeaders?.["retry-after"]);
  const text = `${error.message} ${error.responseBody ?? ""}`;
  const ms = text.match(/try again in ([\d.]+)ms/i);
  // "m(?!s)" so "760ms" isn't read as 760 minutes.
  const match = text.match(/try again in (?:(\d+)h)?(?:(\d+)m(?!s))?(?:([\d.]+)s)?/i);
  const seconds = ms
    ? Number(ms[1]) / 1000
    : match?.slice(1).some(Boolean)
      ? Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0)
      : retryAfter;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

/** The wait, rounded up for people. */
const waitFrom = (error: APICallError) => {
  const seconds = retryAfterSeconds(error);
  if (!seconds) return "a little while";
  if (seconds < 5) return "a few seconds";
  if (seconds < 90) return `about ${Math.ceil(seconds)} seconds`;
  if (seconds < 5400) return `about ${Math.ceil(seconds / 60)} minutes`;
  return `about ${Math.ceil(seconds / 3600)} hours`;
};

/**
 * Turns a model-provider failure into a message the participant can act on
 * (work item G4). Never includes the provider's raw error text, which can
 * carry account or organization details.
 */
export function describeProviderError(error: unknown, mode: AppMode): string {
  const settingsHint = mode === "self-hosted" ? " or choose another model or provider in Settings" : "";
  const api = apiError(error);
  if (!api) return "Something went wrong generating this turn. Please try again.";

  const status = api.statusCode;
  const text = `${api.message} ${api.responseBody ?? ""}`.toLowerCase();
  if (status === 429) {
    const daily = /per day|tpd|rpd|daily/.test(text);
    return daily
      ? `The model provider's daily usage limit has been reached. Try again in ${waitFrom(api)}${settingsHint}.`
      : `The model provider is limiting requests right now. Wait ${waitFrom(api)} and submit again.`;
  }
  if (status === 401 || status === 403) {
    return mode === "self-hosted"
      ? "The model provider rejected the API key. Check it in Settings or the server's .env.local."
      : "The service couldn't reach its model provider. Please try again later.";
  }
  if (/tool call validation failed|did not match schema/.test(text)) {
    return `The model returned an incomplete turn. Submit your response again${settingsHint ? `; if it keeps happening, choose a larger model in Settings` : ""}.`;
  }
  if (status === 404) return `The model provider doesn't recognize the selected model${settingsHint ? `; choose another in Settings` : ""}.`;
  if (status !== undefined && status >= 500) return "The model provider is having problems. Please try again shortly.";
  return "The model provider returned an error. Please try again.";
}
