import { lstatSync, mkdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

import { getAppMode } from "@/lib/config";
import { assertUnlinkedLocalDatabase } from "@/lib/local-database";
import { LocalConnectionAuth } from "@/lib/local-connection-auth";
import { handleLocalConnection, localConnectionOrigin, localConnectionRequestAllowed } from "@/lib/local-connection-http";
import { LocalExerciseService } from "@/lib/local-exercise-service";
import { ClaudeCli, configuredClaudeExecutable } from "@/lib/claude-cli";

function canonicalPathIncludingMissingParts(filename: string) {
  let current = path.resolve(filename);
  const missingParts: string[] = [];
  while (true) {
    try { return path.resolve(realpathSync(current), ...missingParts); }
    catch (error) {
      if (!error || typeof error !== "object" || !("code" in error)
        || (error.code !== "ENOENT" && error.code !== "ENOTDIR")) throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      missingParts.unshift(path.basename(current));
      current = parent;
    }
  }
}

function isWithin(candidate: string, root: string) {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export function assertLocalDataDirectoryOutsideRoots(directory: string, roots: string[]) {
  const candidate = canonicalPathIncludingMissingParts(directory);
  for (const root of roots) {
    if (!path.isAbsolute(root)) throw new Error("Local storage protection roots must be absolute.");
    if (isWithin(candidate, realpathSync(root))) {
      throw new Error("Local data must be outside the application source, install, and working directories.");
    }
  }
}

function fileExists(filename: string) {
  try { lstatSync(filename); return true; }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

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
    const roots = [process.cwd(), process.env.READYSTATE_LOCAL_SOURCE_ROOT, process.env.READYSTATE_LOCAL_INSTALL_ROOT]
      .filter((root): root is string => Boolean(root));
    assertLocalDataDirectoryOutsideRoots(directory, roots);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    assertLocalDataDirectoryOutsideRoots(directory, roots);
    if (process.platform !== "win32" && (statSync(directory).mode & 0o077) !== 0) {
      throw new Error("Local data directory permissions must be private to the operator.");
    }
    const credentialsFile = path.join(directory, "connection-credentials.sqlite");
    const exercisesFile = path.join(directory, "exercises.sqlite");
    assertLocalDataDirectoryOutsideRoots(credentialsFile, roots);
    assertLocalDataDirectoryOutsideRoots(exercisesFile, roots);
    for (const filename of [credentialsFile, exercisesFile]) {
      for (const suffix of ["", "-journal", "-wal", "-shm"]) {
        assertUnlinkedLocalDatabase(filename + suffix);
      }
    }
    const credentialsExist = fileExists(credentialsFile);
    const exercisesExist = fileExists(exercisesFile);
    if (credentialsExist !== exercisesExist) {
      throw new Error("Local storage is incomplete. Refusing to replace owner identity or exercise data.");
    }
    const allowInitialization = !credentialsExist && !exercisesExist;
    if (!allowInitialization) {
      LocalConnectionAuth.assertInitialized(credentialsFile);
      LocalExerciseService.assertInitialized(exercisesFile);
    }
    auth = new LocalConnectionAuth(credentialsFile, code, Date.now, allowInitialization);
    exercises = new LocalExerciseService(exercisesFile, allowInitialization);
    return await handleLocalConnection(request, client, {
      origin, auth, exercises,
      claude: () => new ClaudeCli(configuredClaudeExecutable(), process.env.READYSTATE_CLAUDE_CLI_EVALUATION === "1"),
    });
  } catch {
    console.error("[local-connection] startup failed; no storage reset was attempted. Check local configuration and storage permissions, then restart.");
    return Response.json({ error: "Local connection startup failed. Check local configuration and storage permissions." }, {
      status: 503, headers: { "Cache-Control": "no-store" },
    });
  } finally {
    exercises?.close();
    auth?.close();
  }
}
