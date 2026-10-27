/**
 * `self-hosted` (default): single user, no sign-in, provider and API keys come
 * from the server env or the browser's Settings panel.
 * `hosted`: the paid online service. Requests must be signed in and within
 * quota (see `lib/hosted.ts`), and only the operator's server-side provider
 * configuration is used.
 */
export type AppMode = "self-hosted" | "hosted";

/** Read at request time so one Docker image can run in either mode. */
export const getAppMode = (): AppMode =>
  process.env.READYSTATE_MODE === "hosted" ? "hosted" : "self-hosted";
