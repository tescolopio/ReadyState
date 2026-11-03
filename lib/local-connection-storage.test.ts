import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocalConnectionAuth } from "@/lib/local-connection-auth";
import { localConnectionRoute } from "@/lib/local-connection-runtime";
import { LocalExerciseService } from "@/lib/local-exercise-service";
import { openExistingLocalDatabase } from "@/lib/local-database";

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
  it("non-creating recovery never creates a missing database", () => {
    const filename = path.join(directory, "absent.sqlite");
    expect(() => openExistingLocalDatabase(filename)).toThrow();
    expect(existsSync(filename)).toBe(false);
  });

  it.each(["connection-credentials.sqlite", "exercises.sqlite"])("refuses a hard-linked %s before either store is used", async filename => {
    const data = path.join(directory, "private-data");
    mkdirSync(data, { mode: 0o700 });
    const auth = new LocalConnectionAuth(path.join(data, "connection-credentials.sqlite"), ownerCode);
    auth.close();
    const service = new LocalExerciseService(path.join(data, "exercises.sqlite"));
    service.close();
    const target = path.join(data, filename);
    linkSync(target, path.join(directory, "exposed.sqlite"));
    const before = readFileSync(target);
    configure(data);
    expect((await localConnectionRoute(request(), "browser")).status).toBe(503);
    expect(readFileSync(target)).toEqual(before);
  });

  it("refuses symbolic database and journal links without following them", async () => {
    const data = path.join(directory, "private-data");
    mkdirSync(data, { mode: 0o700 });
    const exposed = path.join(directory, "exposed.sqlite");
    writeFileSync(exposed, "must not change");
    // A directory junction is a Windows unprivileged symlink-equivalent refusal.
    const target = path.join(data, "connection-credentials.sqlite");
    symlinkSync(directory, target, process.platform === "win32" ? "junction" : "dir");
    configure(data);
    expect((await localConnectionRoute(request(), "browser")).status).toBe(503);
    expect(readFileSync(exposed, "utf8")).toBe("must not change");
  });

  it.each(["-journal", "-wal", "-shm"])("refuses linked %s sidecars before recovery opens a store", async suffix => {
    const data = path.join(directory, "private-data");
    mkdirSync(data, { mode: 0o700 });
    const credentials = path.join(data, "connection-credentials.sqlite");
    const auth = new LocalConnectionAuth(credentials, ownerCode);
    auth.close();
    const service = new LocalExerciseService(path.join(data, "exercises.sqlite"));
    service.close();
    const exposed = path.join(directory, "exposed-sidecar");
    writeFileSync(exposed, "not a private file");
    linkSync(exposed, credentials + suffix);
    const before = readFileSync(credentials);
    configure(data);
    expect((await localConnectionRoute(request(), "browser")).status).toBe(503);
    expect(readFileSync(credentials)).toEqual(before);
    expect(readFileSync(exposed, "utf8")).toBe("not a private file");
  });

  it.each(["connection-credentials.sqlite", "exercises.sqlite"])("recovers a real hot rollback journal for %s without resetting data", async filename => {
    const data = path.join(directory, "private-data");
    mkdirSync(data, { mode: 0o700 });
    const credentials = path.join(data, "connection-credentials.sqlite");
    const exercises = path.join(data, "exercises.sqlite");
    const auth = new LocalConnectionAuth(credentials, ownerCode);
    const owner = auth.owner;
    auth.close();
    const service = new LocalExerciseService(exercises);
    service.close();
    const target = path.join(data, filename);
    const child = spawn(process.execPath, ["-e", `
      const {DatabaseSync}=require("node:sqlite");
      const db=new DatabaseSync(process.argv[1]);
      db.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA cache_size=1; BEGIN IMMEDIATE;");
      if(process.argv[2]==="connection-credentials.sqlite"){
        db.exec("UPDATE connection_meta SET value='uncommitted';");
        const insert=db.prepare("INSERT INTO connection_codes VALUES (?)");
        for(let i=0;i<200;i++) insert.run(i+"x".repeat(8192));
      }else{
        const insert=db.prepare("INSERT INTO exercise_sessions VALUES (?,?)");
        for(let i=0;i<200;i++) insert.run(String(i),JSON.stringify({padding:"x".repeat(8192)}));
      }
      process.stdout.write("ready\\n");
      setInterval(()=>{},1000);
    `, target, filename], { stdio: ["ignore", "pipe", "ignore"] });
    try {
      await Promise.race([
        once(child.stdout!, "data"),
        once(child, "exit").then(() => { throw new Error("Crash fixture exited before writing"); }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Crash fixture timed out")), 5000).unref()),
      ]);
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
      expect(existsSync(target + "-journal")).toBe(true);
      const readOnly = new DatabaseSync(target, { readOnly: true });
      try { expect(() => readOnly.prepare("SELECT name FROM sqlite_master").all()).toThrow(); }
      finally { readOnly.close(); }
      configure(data);
      expect((await localConnectionRoute(request(), "browser")).status).toBe(200);
      const restored = new LocalConnectionAuth(credentials, ownerCode);
      try { expect(restored.owner).toBe(owner); }
      finally { restored.close(); }
      const restoredService = new LocalExerciseService(exercises);
      try { expect(restoredService.listOwnedSessions(owner)).toEqual([]); }
      finally { restoredService.close(); }
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGKILL");
        await exited;
      }
    }
  }, 10_000);
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
