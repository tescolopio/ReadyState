import { createHash, timingSafeEqual } from "node:crypto";

/** Whether the trial gate applies: always on Vercel, and locally once a password is set (an empty value is unset). */
export const trialGateOn = () => process.env.VERCEL === "1" || !!process.env.READYSTATE_TRIAL_PASSWORD;

/** A shared password for a small, trusted trial, not customer accounts or quotas. */
export function requireTrialAccess(request: Request): Response | null {
  const password = process.env.READYSTATE_TRIAL_PASSWORD;
  if (!trialGateOn()) return null;

  const headers = {
    "Cache-Control": "private, no-store",
    "X-Robots-Tag": "noindex, nofollow",
    Vary: "Authorization",
  };
  // Fail closed on every Vercel deployment, including previews, even without a key.
  if (!password || password.length < 24) {
    return Response.json(
      { error: "This private trial is not configured. Set READYSTATE_TRIAL_PASSWORD to a random password of at least 24 characters and redeploy." },
      { status: 503, headers },
    );
  }

  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(authorization);
  const supplied = match ? Buffer.from(match[1], "base64") : Buffer.alloc(0);
  const digest = (value: string | Buffer) => createHash("sha256").update(value).digest();
  if (timingSafeEqual(digest(supplied), digest(`trial:${password}`))) return null;

  return Response.json(
    { error: "Sign in with the trial username and password." },
    { status: 401, headers: { ...headers, "WWW-Authenticate": 'Basic realm="ReadyState trial", charset="UTF-8"' } },
  );
}
