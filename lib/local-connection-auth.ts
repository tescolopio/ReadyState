import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { lstatSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { openExistingLocalDatabase } from "@/lib/local-database";

export class LocalConnectionDenied extends Error {
  constructor() { super("Local connection access refused. Unlock locally or pair again."); }
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const secret = () => randomBytes(32).toString("hex");
const validSecret = (value: string) => /^[a-f0-9]{64}$/.test(value);
const connectionSchema = z.object({
  id: z.string().uuid(), principal: z.string().uuid(), session_id: z.string().uuid(),
  permission: z.enum(["read", "write"]), expires: z.number(), paired: z.number().int(),
});

function fileIsAbsent(filename: string) {
  try { lstatSync(filename); return false; }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return true;
    throw error;
  }
}

function validateCredentialDatabase(db: DatabaseSync) {
  const version = db.prepare("PRAGMA user_version").get()?.user_version;
  const app = db.prepare("PRAGMA application_id").get()?.application_id;
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map(row => row.name).join(",");
  if (version !== 1 || app !== 1381188931
    || names !== "connection_codes,connection_meta,connection_owners,connections") {
    throw new Error("Unrecognized or uninitialized local credential database. Refusing to reset it.");
  }
  const owner = db.prepare("SELECT value FROM connection_meta WHERE key = 'owner'").get()?.value;
  if (typeof owner !== "string") throw new Error("Local credential database is missing its owner identity. Refusing to replace it.");
  return z.string().uuid().parse(owner);
}

/** Separate credential database: hashes only, excluded from exercise exports. */
export class LocalConnectionAuth {
  private readonly db: DatabaseSync;
  readonly owner: string;

  constructor(
    filename: string,
    private readonly ownerCode: string,
    private readonly now = Date.now,
    allowInitialization = fileIsAbsent(filename),
  ) {
    if (!validSecret(ownerCode)) throw new Error("Local owner setup requires a random 32-byte hexadecimal code.");
    this.db = allowInitialization ? new DatabaseSync(filename) : openExistingLocalDatabase(filename);
    try {
      this.db.exec("PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE;");
      const version = this.db.prepare("PRAGMA user_version").get()?.user_version;
      const app = this.db.prepare("PRAGMA application_id").get()?.application_id;
      const names = this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map(row => row.name).join(",");
      if (version === 0 && app === 0 && names === "") {
        if (!allowInitialization) throw new Error("Local credential database is uninitialized. Refusing to replace it.");
        this.db.exec(`
          CREATE TABLE connection_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
          CREATE TABLE connection_codes (hash TEXT PRIMARY KEY);
          CREATE TABLE connection_owners (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);
          CREATE TABLE connections (
            id TEXT PRIMARY KEY, principal TEXT NOT NULL UNIQUE, session_id TEXT NOT NULL,
            permission TEXT NOT NULL, code_hash TEXT UNIQUE, token_hash TEXT UNIQUE,
            expires INTEGER NOT NULL, paired INTEGER NOT NULL DEFAULT 0
          );
          PRAGMA application_id = 1381188931;
          PRAGMA user_version = 1;
        `);
        this.db.prepare("INSERT INTO connection_meta VALUES ('owner', ?)").run(randomUUID());
      }
      this.owner = validateCredentialDatabase(this.db);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  static assertInitialized(filename: string) {
    const db = openExistingLocalDatabase(filename);
    try { db.exec("PRAGMA busy_timeout = 5000;"); validateCredentialDatabase(db); }
    finally { db.close(); }
  }

  close() { this.db.close(); }

  unlock(code: string) {
    if (!validSecret(code) || !timingSafeEqual(Buffer.from(hash(code)), Buffer.from(hash(this.ownerCode)))) {
      throw new LocalConnectionDenied();
    }
    return this.transaction(() => {
      if (this.db.prepare("SELECT hash FROM connection_codes WHERE hash = ?").get(hash(code))) throw new LocalConnectionDenied();
      const token = secret();
      this.db.prepare("INSERT INTO connection_codes VALUES (?)").run(hash(code));
      this.db.exec("DELETE FROM connection_owners");
      this.db.prepare("INSERT INTO connection_owners VALUES (?, ?)").run(hash(token), this.now() + 12 * 60 * 60 * 1000);
      return token;
    });
  }

  authenticateOwner(token: string) {
    if (!validSecret(token) || !this.db.prepare("SELECT hash FROM connection_owners WHERE hash = ? AND expires > ?").get(hash(token), this.now())) {
      throw new LocalConnectionDenied();
    }
    return this.owner;
  }

  lock(token: string) { this.db.prepare("DELETE FROM connection_owners WHERE hash = ?").run(hash(token)); }

  issue(sessionId: string, permission: "read" | "write", grant: (principal: string) => void) {
    z.string().uuid().parse(sessionId);
    z.enum(["read", "write"]).parse(permission);
    return this.transaction(() => {
      const code = secret();
      const principal = randomUUID();
      const id = randomUUID();
      grant(principal);
      this.db.prepare("INSERT INTO connections (id, principal, session_id, permission, code_hash, expires) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, principal, sessionId, permission, hash(code), this.now() + 5 * 60 * 1000);
      return { id, code, expiresAt: this.now() + 5 * 60 * 1000 };
    });
  }

  redeem(code: string) {
    if (!validSecret(code)) throw new LocalConnectionDenied();
    return this.transaction(() => {
      const row = this.db.prepare("SELECT * FROM connections WHERE code_hash = ? AND paired = 0 AND expires > ?").get(hash(code), this.now());
      if (!row) throw new LocalConnectionDenied();
      const connection = connectionSchema.parse(row);
      const token = secret();
      const expiresAt = this.now() + 30 * 24 * 60 * 60 * 1000;
      this.db.prepare("UPDATE connections SET code_hash = NULL, token_hash = ?, expires = ?, paired = 1 WHERE id = ?")
        .run(hash(token), expiresAt, connection.id);
      return { token, sessionId: connection.session_id, permission: connection.permission, expiresAt };
    });
  }

  authenticateConnector(token: string, sessionId: string, write: boolean) {
    if (!validSecret(token)) throw new LocalConnectionDenied();
    const row = this.db.prepare("SELECT * FROM connections WHERE token_hash = ? AND paired = 1 AND expires > ?").get(hash(token), this.now());
    if (!row) throw new LocalConnectionDenied();
    const connection = connectionSchema.parse(row);
    if (connection.session_id !== sessionId || (write && connection.permission !== "write")) throw new LocalConnectionDenied();
    return connection.principal;
  }

  list() {
    return this.db.prepare("SELECT * FROM connections ORDER BY id").all().map(row => {
      const connection = connectionSchema.parse(row);
      return {
        id: connection.id, sessionId: connection.session_id, permission: connection.permission,
        paired: connection.paired === 1, expiresAt: connection.expires,
      };
    });
  }

  revoke(connectionId: string, revokeGrant: (sessionId: string, principal: string) => void) {
    z.string().uuid().parse(connectionId);
    const row = this.db.prepare("SELECT * FROM connections WHERE id = ?").get(connectionId);
    if (!row) return;
    const connection = connectionSchema.parse(row);
    // Deny the credential first, including if grant cleanup fails and must be retried.
    this.db.prepare("UPDATE connections SET token_hash = NULL, code_hash = NULL WHERE id = ?").run(connectionId);
    revokeGrant(connection.session_id, connection.principal);
    this.db.prepare("DELETE FROM connections WHERE id = ?").run(connectionId);
  }

  private transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const value = work(); this.db.exec("COMMIT"); return value; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
}
