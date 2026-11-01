# Private Vercel trial

This is a small, trusted trial of the self-hosted app, not the paid hosted service.
The entire deployment requires a shared browser password. API handlers also
check access directly before resolving a provider or calling a model.
On Vercel, a missing or short trial password returns 503; there is no public fallback.
Local self-hosting is unchanged unless the trial password is set.

## Import settings

Import ReadyState from GitHub after these changes land on the branch being imported.
Use Next.js, root `./`, production branch `main`, Node.js 24.x (pinned in
package.json), and the detected build/install/output settings. Do not select
static export or deploy the Docker image through Vercel. The existing standalone
output remains for Docker; Vercel uses its Next.js integration.

Set these server environment variables before the first deployment, for both
Production and Preview:

| Variable | Value |
| --- | --- |
| `READYSTATE_TRIAL_PASSWORD` | A unique randomly generated password of at least 24 characters; use a password manager |
| `READYSTATE_MODE` | `self-hosted` (or leave unset) |
| `READYSTATE_PROVIDER` | `groq` (or leave unset) |

Leave provider keys unset for the first UI smoke test. Do not set
`READYSTATE_CAPTURE_DEBRIEF_DRAFTS`; capture is forcibly disabled on Vercel even
if that flag and the eval header are present. Never prefix secrets with
`NEXT_PUBLIC_`, put them in Git, or paste them into build logs.

The browser will ask for username **trial** and the password you configured.
Use Vercel's HTTPS URL. Basic authentication is a shared trial gate, not user
accounts, billing, individual revocation, or rate limiting. Only share it with
trusted testers: authenticated users can select providers and endpoints just
as in a self-hosted install. Browsers cache these credentials; use a private
window to test denial. Rotate the password and redeploy to revoke old access.

Keep Vercel's automatic system environment variables enabled (`VERCEL=1` is
used to require the gate). Do not override `VERCEL`. Configure Preview too:
those deployment URLs need the same protection as the production URL.

## First checks: no model calls

1. In a fresh private window, opening `/`, `/journal`, `/settings` or
   `/api/config` must ask for credentials. Wrong credentials must not grant access.
2. Sign in and check the website, both visual styles, household setup, navigation,
   inventory and action plan. Refresh and confirm browser-local data persists.
3. `/api/config` must contain no secrets; `/api/ttx` must report
   `captureDebriefDrafts: false`.
4. A POST to `/api/ttx` without authorization must return 401 before any model
   work. A deployment missing the trial password must return 503.
5. Check the Vercel build and runtime logs for failures. Do not run the paid evals
   or click through an AI exercise as part of this no-call smoke test.
6. With provider keys unset on the server and in a fresh browser's Settings,
   start a fictional household review, inspect the editable masked briefing,
   test masking and damaged-tag validation, then cancel with **Back, don't send**.
   Confirm no POST to `/api/ttx` occurred. Do not press **Send this**, retry or
   debrief on the Groq-connected development server. Transmission assertions
   belong in an isolated mocked browser run.

Prioritize this private trial over downloadable releases. Packaging does not
resolve the open accuracy or safety findings. Mocked browser runs do not verify
real provider responses or debrief quality; real-phone, Safari and Firefox
coverage remains outstanding. Authorize a live exercise separately after the
deployed no-call checks.

After these checks, enable AI deliberately: add `GROQ_API_KEY` in Vercel and
redeploy, or use the app's Settings for your own key. Settings keys are stored
in that browser and sent to this server to call the selected provider. A server
key is shared by everyone with the trial password. Use one tester at a time
initially and watch the provider's quota; this gate does not implement quotas.

The route declares a 60-second host duration and a shared 55-second model-work
budget. Confirm the deployed function honors that configuration. Hosted
streaming, timeout handling, schema retry and debrief fallback still need live
verification; local tests do not establish their deployed behavior.

## Trial limits

Use synthetic households first. Masking and automated debrief checks have known
limitations. The experimental G11 judge is eval-only and does not protect app
output; manual review occurs in evaluations, not before participants see a
debrief. Finding 32 and G6 remain open. Treat the app as preparedness practice,
not real-time emergency guidance.

`READYSTATE_MODE=hosted` is not a shortcut to deployment authentication: its
account/quota implementation is unfinished and it refuses exercise requests.
The shared trial gate is separate from that future service.

References: [Vercel Git import](https://vercel.com/docs/git),
[environment variables](https://vercel.com/docs/environment-variables),
[Node versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).

## Preparation validation

- 450 unit tests passed; one existing todo. Typecheck and lint passed.
- The production Docker image built successfully on Linux. A no-model-call
  smoke test against that image passed for local self-hosting, Vercel without
  a password (503), the authenticated trial, and unfinished hosted mode (503
  for exercises). The trial test covered pages, API requests, static assets,
  and capture disabled despite both capture flags.
- Windows `next build` failed in Turbopack's CSS worker startup, including a
  retry with normal process access. Linux production compilation succeeded;
  the Windows build issue is unresolved.
- CI now includes the private-trial smoke checks. Remote CI and an actual
  Vercel deployment have not run for these changes.
