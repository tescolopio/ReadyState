import { connection } from "next/server";

import { getAppMode } from "@/lib/config";
import { requireTrialAccess } from "@/lib/trial-access";
import {
  PROVIDERS,
  PROVIDER_IDS,
  isServerConfigured,
  serverDefaultProvider,
  type ServerConfig,
} from "@/lib/providers";

/**
 * Public, key-free description of this server's setup. The client uses it to
 * decide whether to show the provider Settings panel (self-hosted) or the
 * hosted-service flow, and which providers already have a server-side key.
 */
export async function GET(req: Request) {
  const denied = requireTrialAccess(req);
  if (denied) return denied;
  // Read env at request time, not at build time, so one image serves both modes.
  await connection();
  const mode = getAppMode();

  return Response.json({
    mode,
    defaultProvider: serverDefaultProvider(),
    providers:
      mode === "self-hosted"
        ? PROVIDER_IDS.map((id) => ({
            id,
            label: PROVIDERS[id].label,
            defaultModel: PROVIDERS[id].defaultModel ?? null,
            requiresKey: PROVIDERS[id].requiresKey,
            editableBaseURL: PROVIDERS[id].editableBaseURL ?? false,
            serverConfigured: isServerConfigured(id),
          }))
        : [],
  } satisfies ServerConfig);
}
