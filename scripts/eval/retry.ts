/**
 * How the eval recovers from provider limits: like a patient participant, it
 * waits as long as the app says and submits the same request again, so a
 * recovered call neither loses nor repeats a turn.
 */

/**
 * The wait the app tells participants, in ms: "about 12 seconds", "about 2
 * minutes", "a few seconds", or "a little while" when the provider gave none.
 * Undefined when the error isn't a per-minute limit.
 */
export function rateLimitWait(error: string): number | undefined {
  if (!/limiting requests/i.test(error)) return undefined;
  const match = error.match(/about (\d+) (second|minute)/i);
  if (match) return Number(match[1]) * (match[2].toLowerCase() === "minute" ? 60_000 : 1000) + 1000;
  return /a few seconds/i.test(error) ? 5000 : 30_000;
}

export const MAX_RATE_LIMIT_WAITS = 3;

export interface SendOutcome<M> {
  message?: M;
  error?: string;
}

export interface RetriedOutcome<M> extends SendOutcome<M> {
  /** Requests made, including the first. */
  attempts: number;
  /** Time spent waiting out limits, kept out of the latency figures. */
  waitedMs: number;
  /** Time of the final request alone. */
  requestMs: number;
}

/**
 * Sends, waits out per-minute limits (up to `maxWaits`, MAX_RATE_LIMIT_WAITS
 * by default), and resubmits once after an incomplete turn, which the server
 * has already retried once itself, unless `resubmit` is false. A budgeted run
 * turns both off, so every turn is one request. `send` must make the
 * identical request every time.
 */
export async function sendWithRetries<M>(
  send: () => Promise<SendOutcome<M>>,
  {
    sleep,
    notes,
    label,
    maxWaits = MAX_RATE_LIMIT_WAITS,
    resubmit = true,
  }: { sleep: (ms: number) => Promise<void>; notes: string[]; label: string; maxWaits?: number; resubmit?: boolean },
): Promise<RetriedOutcome<M>> {
  let attempts = 0;
  let waits = 0;
  let waitedMs = 0;
  let resubmitted = false;
  while (true) {
    attempts++;
    const started = performance.now();
    const result = await send();
    const requestMs = Math.round(performance.now() - started);
    if (!result.error) return { ...result, attempts, waitedMs, requestMs };
    const wait = rateLimitWait(result.error);
    if (wait !== undefined && waits < maxWaits) {
      waits++;
      waitedMs += wait;
      notes.push(`${label}: rate limited, waited ${Math.round(wait / 1000)} s`);
      await sleep(wait);
      continue;
    }
    if (resubmit && /incomplete turn/i.test(result.error) && !resubmitted) {
      resubmitted = true;
      notes.push(`${label}: incomplete turn after the server's retry; resubmitted`);
      continue;
    }
    return { ...result, attempts, waitedMs, requestMs };
  }
}
