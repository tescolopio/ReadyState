import { existsSync, mkdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

import { getAppMode } from "@/lib/config";
import { LocalConnectionAuth } from "@/lib/local-connection-auth";
import { handleLocalConnection, localConnectionOrigin, localConnectionRequestAllowed } from "@/lib/local-connection-http";
import { LocalExerciseService } from "@/lib/local-exercise-service";

export async function localConnectionRoute(request: Request, client: "browser" | "connector") {
  if (process.env.READYSTATE_LOCAL_CONNECTIONS !== "1" || process.env.VERCEL
    || getAppMode() !== "self-hosted" || process.env.READYSTATE_TRIAL_PASSWORD) {
    return Response.json({ error: "Local connections are disabled on this server." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  let auth: LocalConnectionAuth | undefined;
  let exercises: LocalExerciseService | undefined;
  try {
    const origin = localConnectionOrigin(process.env.READYSTATE_LOCAL_ORIGIN ?? "");
    if (!localConnectionRequestAllowed(request, client, origin)) {
      return Response.json({ error: "Local connection origin refused." }, { status: 403, headers: { "Cache-Control": "no-store" } });
    }
    const directory = process.env.READYSTATE_LOCAL_DATA_DIR;
    const code = process.env.READYSTATE_LOCAL_OWNER_CODE ?? "";
    if (!directory || !path.isAbsolute(directory) || !/^[a-f0-9]{64}$/.test(code)) {
      throw new Error("Local connection configuration is incomplete.");
    }
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const relative = path.relative(realpathSync(process.cwd()), realpathSync(directory));
    if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
      throw new Error("Local data must be outside the application working directory.");
    }
    if (process.platform !== "win32" && (statSync(directory).mode & 0o077) !== 0) {
      throw new Error("Local data directory permissions must be private to the operator.");
    }
    const credentialsFile = path.join(directory, "connection-credentials.sqlite");
    const exercisesFile = path.join(directory, "exercises.sqlite");
    if (existsSync(credentialsFile) !== existsSync(exercisesFile)) {
      throw new Error("Local storage is incomplete. Refusing to replace owner identity or exercise data.");
    }
    auth = new LocalConnectionAuth(credentialsFile, code);
    exercises = new LocalExerciseService(exercisesFile);
    return await handleLocalConnection(request, client, { origin, auth, exercises });
  } catch {
    console.error("[local-connection] startup failed; check opt-in local configuration and storage permissions");
    return Response.json({ error: "Local connection startup failed. Check local configuration and storage permissions." }, {
      status: 503, headers: { "Cache-Control": "no-store" },
    });
  } finally {
    exercises?.close();
    auth?.close();
  }
}
