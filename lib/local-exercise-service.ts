import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";

import { buildExerciseBriefing, EXERCISE_CONTEXT_VERSION } from "@/lib/exercise-context";
import { EXERCISE_SCHEMA_VERSION } from "@/lib/exercise-contracts";
import { exercisePrompt, EXERCISE_PROMPT_VERSION } from "@/lib/exercise-prompts";
import { EXERCISE_ACCEPTANCE_VERSION, exerciseTurnCandidateSchema, validateExerciseTurn, type TurnProblem } from "@/lib/exercise-turn-validation";

const id = z.string().uuid();
const approvalSchema = z.object({
  id, text: z.string().min(1).max(65_536).refine(value => value.trim().length > 0),
}).strict();
const taskSchema = z.object({
  id, revision: z.number().int().nonnegative(),
  phase: z.enum(["baseline", "loop"]),
  schemaVersion: z.string(), promptVersion: z.string(), contextVersion: z.string(),
  acceptanceVersion: z.string(), contextHash: z.string(),
  shortStepReason: z.string().min(1).max(500).optional(),
}).strict();
const stateSchema = z.object({
  format: z.literal(1), id, owner: id, revision: z.number().int().nonnegative(),
  phase: z.enum(["baseline", "loop", "ended"]),
  baseline: approvalSchema,
  events: z.array(z.object({
    id, response: approvalSchema.optional(), turn: exerciseTurnCandidateSchema, task: taskSchema,
  }).strict()),
  pendingResponse: approvalSchema.optional(),
  task: taskSchema.optional(),
  shortStepReason: z.string().min(1).max(500).optional(),
}).strict();
const receiptSchema = z.object({ sessionId: id, revision: z.number().int().nonnegative(), eventId: id.optional() }).strict();
const commandSchema = z.object({
  sessionId: id, expectedRevision: z.number().int().nonnegative(),
  key: z.string().min(1).max(128),
}).strict();
export type LocalExerciseState = z.infer<typeof stateSchema>;
export type ExerciseCommand = z.infer<typeof commandSchema>;
export type ExerciseReceipt = z.infer<typeof receiptSchema>;
export type ExerciseErrorCode =
  | "access" | "invalid-input" | "corrupt-storage" | "stale-revision"
  | "idempotency-conflict" | "wrong-phase" | "stale-task" | "invalid-turn";

export class LocalExerciseError extends Error {
  constructor(public readonly code: ExerciseErrorCode, public readonly problems: TurnProblem[] = []) {
    super(`Local exercise operation refused: ${code}.`);
    this.name = "LocalExerciseError";
  }
}

function parse<T>(schema: z.ZodType<T>, value: unknown, code: ExerciseErrorCode = "invalid-input"): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new LocalExerciseError(code);
  return result.data;
}

function decode<T>(schema: z.ZodType<T>, value: unknown): T {
  if (typeof value !== "string") throw new LocalExerciseError("corrupt-storage");
  let decoded: unknown;
  try { decoded = JSON.parse(value); } catch { throw new LocalExerciseError("corrupt-storage"); }
  return parse(schema, decoded, "corrupt-storage");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
const digest = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");

/**
 * Internal local-app service, not a network/MCP endpoint. Callers must authenticate
 * principals before invoking it; a principal ID is not a bearer credential.
 * Only the trusted local UI may supply approved snapshots/responses.
 */
export class LocalExerciseService {
  private readonly db: DatabaseSync;

  constructor(filename: string) {
    this.db = new DatabaseSync(filename);
    try {
      this.db.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
      this.transaction(() => {
        const application = this.db.prepare("PRAGMA application_id").get()?.application_id;
        const version = this.db.prepare("PRAGMA user_version").get()?.user_version;
        const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
        const initialized = application === 1381188952 && version === 1;
        const names = tables.map(row => row.name).sort().join(",");
        if ((application !== 0 || version !== 0 || tables.length) && (!initialized
          || names !== "exercise_access,exercise_receipts,exercise_sessions")) {
          throw new LocalExerciseError("corrupt-storage");
        }
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS exercise_sessions (id TEXT PRIMARY KEY, state TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS exercise_access (
            session_id TEXT NOT NULL REFERENCES exercise_sessions(id), principal TEXT NOT NULL,
            can_write INTEGER NOT NULL CHECK (can_write IN (0,1)), PRIMARY KEY(session_id, principal)
          );
          CREATE TABLE IF NOT EXISTS exercise_receipts (
            session_id TEXT NOT NULL REFERENCES exercise_sessions(id), principal TEXT NOT NULL,
            key TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL,
            PRIMARY KEY(session_id, principal, key)
          );
          CREATE UNIQUE INDEX IF NOT EXISTS exercise_approved_baseline
            ON exercise_sessions(json_extract(state, '$.owner'), json_extract(state, '$.baseline.id'));
          PRAGMA application_id = 1381188952;
          PRAGMA user_version = 1;
        `);
      });
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  close() { this.db.close(); }

  private transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private load(sessionId: string): LocalExerciseState {
    const row = this.db.prepare("SELECT state FROM exercise_sessions WHERE id = ?").get(sessionId);
    if (!row) throw new LocalExerciseError("access");
    const state = decode(stateSchema, row.state);
    if (state.id !== sessionId) throw new LocalExerciseError("corrupt-storage");
    const approvals = new Set([state.baseline.id]);
    let previousHour: number | null = null;
    let previousTaskRevision = -1;
    for (const [index, event] of state.events.entries()) {
      if ((index === 0 && event.response) || (index > 0 && !event.response)
        || (event.response && approvals.has(event.response.id))
        || event.task.revision <= previousTaskRevision || event.task.revision >= state.revision
        || event.task.phase !== (index === 0 ? "baseline" : "loop")
        || !validateExerciseTurn(event.turn, { previousHour, shortStepReason: event.task.shortStepReason }).ok) {
        throw new LocalExerciseError("corrupt-storage");
      }
      if (event.response) approvals.add(event.response.id);
      previousHour = event.turn.hours_elapsed;
      previousTaskRevision = event.task.revision;
    }
    const phase = previousHour === null ? "baseline" : previousHour === 72 ? "ended" : "loop";
    if (state.phase !== phase || (state.pendingResponse && (phase !== "loop" || approvals.has(state.pendingResponse.id)))) {
      throw new LocalExerciseError("corrupt-storage");
    }
    return state;
  }

  private save(state: LocalExerciseState) {
    const validated = parse(stateSchema, state);
    this.db.prepare("UPDATE exercise_sessions SET state = ? WHERE id = ?").run(JSON.stringify(validated), state.id);
  }

  private access(sessionId: string, principal: string, write = false): LocalExerciseState {
    parse(id, sessionId);
    parse(id, principal);
    const row = this.db.prepare(
      "SELECT can_write FROM exercise_access WHERE session_id = ? AND principal = ?",
    ).get(sessionId, principal);
    if (!row || (write && row.can_write !== 1)) throw new LocalExerciseError("access");
    return this.load(sessionId);
  }

  private owner(sessionId: string, principal: string): LocalExerciseState {
    const state = this.access(sessionId, principal, true);
    if (state.owner !== principal) throw new LocalExerciseError("access");
    return state;
  }

  /** Approval is a trusted application decision, never an assistant-supplied flag. */
  createApprovedSession(owner: string, input: unknown): ExerciseReceipt {
    parse(id, owner);
    const baseline = parse(approvalSchema, input);
    return this.transaction(() => {
      // Approval references are unique per owner, so retrying creation is recoverable.
      const existing = this.db.prepare(
        "SELECT id FROM exercise_sessions WHERE json_extract(state, '$.owner') = ? AND json_extract(state, '$.baseline.id') = ?",
      ).all(owner, baseline.id);
      if (existing.length) {
        const state = this.load(parse(id, existing[0].id, "corrupt-storage"));
        if (state.baseline.text !== baseline.text) throw new LocalExerciseError("idempotency-conflict");
        return { sessionId: state.id, revision: 0 };
      }
      const state: LocalExerciseState = {
        format: 1, id: randomUUID(), owner, revision: 0, phase: "baseline", baseline, events: [],
      };
      this.db.prepare("INSERT INTO exercise_sessions (id, state) VALUES (?, ?)").run(state.id, JSON.stringify(state));
      this.db.prepare("INSERT INTO exercise_access VALUES (?, ?, 1)").run(state.id, owner);
      return { sessionId: state.id, revision: 0 };
    });
  }

  getState(sessionId: string, principal: string): LocalExerciseState {
    return this.access(sessionId, principal);
  }

  /** Only the local owner can grant/revoke access; transport pairing is separate. */
  setAccess(sessionId: string, owner: string, principal: string, permission: "read" | "write" | "revoke") {
    parse(id, principal);
    parse(z.enum(["read", "write", "revoke"]), permission);
    this.transaction(() => {
      const state = this.owner(sessionId, owner);
      if (principal === owner) throw new LocalExerciseError("access");
      if (permission === "revoke") {
        this.db.prepare("DELETE FROM exercise_access WHERE session_id = ? AND principal = ?").run(sessionId, principal);
        // A task released to this connection must not survive revocation/re-pairing.
        state.task = undefined;
        state.revision++;
        this.save(state);
      } else {
        this.db.prepare(`INSERT INTO exercise_access VALUES (?, ?, ?)
          ON CONFLICT(session_id, principal) DO UPDATE SET can_write = excluded.can_write`)
          .run(sessionId, principal, permission === "write" ? 1 : 0);
      }
    });
  }

  private mutate(principal: string, command: ExerciseCommand, operation: string, payload: unknown,
    change: (state: LocalExerciseState) => { eventId?: string }, ownerOnly = false): ExerciseReceipt {
    parse(commandSchema, command);
    return this.transaction(() => {
      const state = ownerOnly ? this.owner(command.sessionId, principal) : this.access(command.sessionId, principal, true);
      const fingerprint = digest({ operation, payload, expectedRevision: command.expectedRevision });
      const old = this.db.prepare(
        "SELECT fingerprint, result FROM exercise_receipts WHERE session_id = ? AND principal = ? AND key = ?",
      ).get(state.id, principal, command.key);
      if (old) {
        if (old.fingerprint !== fingerprint) throw new LocalExerciseError("idempotency-conflict");
        return decode(receiptSchema, old.result);
      }
      if (state.revision !== command.expectedRevision) throw new LocalExerciseError("stale-revision");
      const extra = change(state);
      state.revision++;
      const result = { sessionId: state.id, revision: state.revision, ...extra };
      this.save(state);
      this.db.prepare("INSERT INTO exercise_receipts VALUES (?, ?, ?, ?, ?)")
        .run(state.id, principal, command.key, fingerprint, JSON.stringify(result));
      return result;
    });
  }

  submitApprovedResponse(owner: string, command: ExerciseCommand, input: unknown): ExerciseReceipt {
    const response = parse(approvalSchema, input);
    return this.mutate(owner, command, "response", response, state => {
      if (state.phase !== "loop" || state.pendingResponse || state.task) throw new LocalExerciseError("wrong-phase");
      if (response.id === state.baseline.id || state.events.some(event => event.response?.id === response.id)) {
        throw new LocalExerciseError("idempotency-conflict");
      }
      state.pendingResponse = response;
      return {};
    }, true);
  }

  permitShortStep(owner: string, command: ExerciseCommand, reason: string): ExerciseReceipt {
    const approvedReason = parse(z.string().trim().min(1).max(500), reason);
    return this.mutate(owner, command, "short-step", approvedReason, state => {
      if (state.phase !== "loop" || !state.pendingResponse || state.task) throw new LocalExerciseError("wrong-phase");
      state.shortStepReason = approvedReason;
      return {};
    }, true);
  }

  private briefing(state: LocalExerciseState) {
    return buildExerciseBriefing({
      baseline: state.baseline.text,
      exchanges: state.events.map(event => ({ action: event.response?.text, turn: event.turn })),
      pendingAction: state.pendingResponse?.text,
    });
  }

  /** Repeated retrieval returns the same task until cancellation or a committed change. */
  getGenerationTask(sessionId: string, principal: string) {
    return this.transaction(() => {
      const state = this.access(sessionId, principal, true);
      if (state.phase === "ended" || (state.phase === "loop" && !state.pendingResponse)) {
        throw new LocalExerciseError("wrong-phase");
      }
      const briefing = this.briefing(state);
      const versions = {
        schemaVersion: EXERCISE_SCHEMA_VERSION, promptVersion: EXERCISE_PROMPT_VERSION,
        contextVersion: EXERCISE_CONTEXT_VERSION, acceptanceVersion: EXERCISE_ACCEPTANCE_VERSION,
      };
      if (!state.task) {
        state.task = {
          id: randomUUID(), revision: state.revision, phase: state.phase, ...versions,
          contextHash: digest(briefing), shortStepReason: state.shortStepReason,
        };
        this.save(state);
      }
      const task = state.task;
      if (task.contextHash !== digest(briefing) || task.revision !== state.revision || task.phase !== state.phase
        || Object.entries(versions).some(([key, value]) => task[key as keyof typeof versions] !== value)) {
        throw new LocalExerciseError("stale-task");
      }
      return { ...task, sessionId, briefing, instructions: exercisePrompt(task.phase),
        outputSchema: z.toJSONSchema(exerciseTurnCandidateSchema),
        clockPolicy: { targetHour: 72, maximumAdvance: 12, normalMinimumAdvance: 6,
          previousHour: state.events.at(-1)?.turn.hours_elapsed ?? null,
          shortStepReason: task.shortStepReason },
      };
    });
  }

  cancelTask(owner: string, command: ExerciseCommand): ExerciseReceipt {
    return this.mutate(owner, command, "cancel", null, state => {
      if (!state.task) throw new LocalExerciseError("wrong-phase");
      state.task = undefined;
      state.shortStepReason = undefined;
      return {};
    }, true);
  }

  submitTurn(principal: string, command: ExerciseCommand, taskId: string, candidate: unknown): ExerciseReceipt {
    parse(id, taskId);
    // Bound serialized input before fingerprinting; never include candidate text in errors.
    let serialized: string | undefined;
    try { serialized = JSON.stringify(candidate); } catch { throw new LocalExerciseError("invalid-input"); }
    if (!serialized || Buffer.byteLength(serialized) > 131_072) throw new LocalExerciseError("invalid-input");
    const shaped = exerciseTurnCandidateSchema.safeParse(candidate);
    if (!shaped.success) throw new LocalExerciseError("invalid-turn", [{ field: "", code: "shape" }]);
    return this.mutate(principal, command, "turn", { taskId, candidate: shaped.data }, state => {
      const task = state.task;
      if (!task || task.id !== taskId || task.revision !== state.revision
        || task.schemaVersion !== EXERCISE_SCHEMA_VERSION || task.promptVersion !== EXERCISE_PROMPT_VERSION
        || task.contextVersion !== EXERCISE_CONTEXT_VERSION || task.acceptanceVersion !== EXERCISE_ACCEPTANCE_VERSION
        || task.phase !== state.phase || task.contextHash !== digest(this.briefing(state))) {
        throw new LocalExerciseError("stale-task");
      }
      if (state.phase === "loop" && !state.pendingResponse) {
        throw new LocalExerciseError("wrong-phase");
      }
      const validated = validateExerciseTurn(candidate, {
        previousHour: state.events.at(-1)?.turn.hours_elapsed ?? null, shortStepReason: task.shortStepReason,
      });
      if (!validated.ok) throw new LocalExerciseError("invalid-turn", validated.problems);
      const eventId = randomUUID();
      state.events.push({ id: eventId, response: state.pendingResponse, turn: validated.turn, task });
      state.pendingResponse = undefined;
      state.shortStepReason = undefined;
      state.task = undefined;
      state.phase = validated.turn.scenario_status === "complete" ? "ended" : "loop";
      return { eventId };
    });
  }
}
