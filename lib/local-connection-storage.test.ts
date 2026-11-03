import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocalConnectionAuth } from "@/lib/local-connection-auth";
import { localConnectionRoute } from "@/lib/local-connection-runtime";
import { LocalExerciseService } from "@/lib/local-exercise-service";

const origin = "http://127.0.0.1:3179";
const ownerCode = randomBytes(32).toString("hex");
let directory: string;
let sourceRoot: string;

function request() {
  return new Request(`${origin}/api/local-connection`, {
    method: "POST",
    headers: { Host: new URL(origin).host, Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "unlock", code: ownerCode }),
  });
}

function configure(dataDirectory: string, root = sourceRoot) {
  for (const [name, value] of Object.entries({
    READYSTATE_LOCAL_CONNECTIONS: "1",
    READYSTATE_LOCAL_ORIGIN: origin,
    READYSTATE_LOCAL_DATA_DIR: dataDirectory,
    READYSTATE_LOCAL_OWNER_CODE: ownerCode,
    READYSTATE_LOCAL_SOURCE_ROOT: root,
    READYSTATE_LOCAL_INSTALL_ROOT: "",
    READYSTATE_MODE: "self-hosted",
    READYSTATE_TRIAL_PASSWORD: "",
    VERCEL: "",
  })) vi.stubEnv(name, value);
}

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "readystate-storage-"));
  sourceRoot = path.join(directory, "source");
  mkdirSync(path.join(sourceRoot, "public"), { recursive: true });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

describe("local connection storage initialization", () => {
  it("creates a fresh database pair only when neither file exists", async () => {
    const dataDirectory = path.join(directory, "private-data");
    configure(dataDirectory);

    expect((await localConnectionRoute(request(), "browser")).status).toBe(200);
    LocalConnectionAuth.assertInitialized(path.join(dataDirectory, "connection-credentials.sqlite"));
    LocalExerciseService.assertInitialized(path.join(dataDirectory, "exercises.sqlite"));
  });

  it("refuses existing empty databases without initializing either one", async () => {
    const dataDirectory = path.join(directory, "existing-empty");
    mkdirSync(dataDirectory);
    const credentials = path.join(dataDirectory, "connection-credentials.sqlite");
    const exercises = path.join(dataDirectory, "exercises.sqlite");
    writeFileSync(credentials, "");
    writeFileSync(exercises, "");
    configure(dataDirectory);

    expect((await localConnectionRoute(request(), "browser")).status).toBe(503);
    expect(readFileSync(credentials)).toHaveLength(0);
    expect(readFileSync(exercises)).toHaveLength(0);
  });

  it("refuses an initialized credential database with no owner instead of minting a new identity", () => {
    const filename = path.join(directory, "ownerless.sqlite");
    const auth = new LocalConnectionAuth(filename, ownerCode);
    auth.close();
    const db = new DatabaseSync(filename);
    db.prepare("DELETE FROM connection_meta WHERE key = 'owner'").run();
    db.close();
    const before = readFileSync(filename);

    expect(() => new LocalConnectionAuth(filename, ownerCode)).toThrow(/missing its owner identity/i);
    expect(readFileSync(filename)).toEqual(before);
  });

  it("preflights both existing schemas before opening either for use", async () => {
    const dataDirectory = path.join(directory, "partially-initialized");
    mkdirSync(dataDirectory);
    const credentials = path.join(dataDirectory, "connection-credentials.sqlite");
    const exercises = path.join(dataDirectory, "exercises.sqlite");
    const auth = new LocalConnectionAuth(credentials, ownerCode);
    auth.close();
    const service = new LocalExerciseService(exercises);
    service.close();
    writeFileSync(exercises, "");
    const credentialBytes = readFileSync(credentials);
    configure(dataDirectory);

    expect((await localConnectionRoute(request(), "browser")).status).toBe(503);
    expect(readFileSync(credentials)).toEqual(credentialBytes);
    expect(readFileSync(exercises)).toHaveLength(0);
  });

  it("rejects data under source public before creating directories", async () => {
    const dataDirectory = path.join(sourceRoot, "public", "private", "nested-data");
    configure(dataDirectory);

    expect((await localConnectionRoute(request(), "browser")).status).toBe(503);
    expect(existsSync(dataDirectory)).toBe(false);
  });

  it("resolves symlinked paths before checking non-existing data directories", async () => {
    const alias = path.join(directory, "public-alias");
    symlinkSync(path.join(sourceRoot, "public"), alias, process.platform === "win32" ? "junction" : "dir");
    const dataDirectory = path.join(alias, "private", "not-created");
    configure(dataDirectory);

    expect((await localConnectionRoute(request(), "browser")).status).toBe(503);
    expect(existsSync(path.join(sourceRoot, "public", "private"))).toBe(false);
  });
});
