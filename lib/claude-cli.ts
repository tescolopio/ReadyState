import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";

import { claudeCliEvidenceSchema, claudeRequestedModelSchema } from "@/lib/claude-cli-contracts";
import { claudeProcessCommand, killClaudeProcessTree } from "@/lib/claude-owned-process";
import { DIAGNOSTIC_CLI_REQUEST, diagnosticTurn, diagnosticTurnSchema } from "@/lib/connection-diagnostic.mjs";

export class ClaudeCliError extends Error {}
type ProcessResult = { code: number | null; stdout: string; stderr: string };
export type ClaudeRunner = (executable: string, args: string[], input: string, signal: AbortSignal) => Promise<ProcessResult>;

export function claudeEnvironment(source: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const allowed = new Set(["PATH", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "SYSTEMROOT", "WINDIR",
    "COMSPEC", "PATHEXT", "TEMP", "TMP", "LANG", "LC_ALL"]);
  return { ...Object.fromEntries(Object.entries(source).filter(([key]) => allowed.has(key.toUpperCase()))), NODE_ENV: "production" };
}

export function createClaudeProcessRunner(timeoutMs = 90_000): ClaudeRunner {
  return (executable, args, input, signal) => runClaudeInvocation(timeoutMs, executable, args, input, signal);
}

async function runClaudeInvocation(
  timeoutMs: number, executable: string, args: string[], input: string, signal: AbortSignal,
): Promise<ProcessResult> {
  if (signal.aborted) throw new ClaudeCliError("Claude request cancelled. Refresh saved results before retrying.");
  const directory = mkdtempSync(path.join(tmpdir(), "readystate-claude-"));
  try {
    return await new Promise<ProcessResult>((resolve, reject) => {
      const command = claudeProcessCommand(executable, args);
      const child = spawn(command.executable, command.args, {
        cwd: directory, env: claudeEnvironment(process.env), shell: false, windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"], detached: command.detached,
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let bytes = 0;
      let failure: ClaudeCliError | undefined;
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
      let settled = false;
      let exited = false;
      let code: number | null = null;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(cleanupTimer);
        signal.removeEventListener("abort", abort);
        child.stdin.destroy();
        child.stdout.destroy();
        child.stderr.destroy();
        if (failure) reject(failure);
        else resolve({ code, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
      };
      const cleanup = () => {
        if (cleanupTimer || settled) return;
        // close can be delayed indefinitely by inherited pipes. Never use it
        // as the sole settlement trigger, even if tree termination fails.
        cleanupTimer = setTimeout(() => {
          failure ??= new ClaudeCliError("Claude output streams did not close. Nothing was accepted; retry explicitly.");
          finish();
        }, 1_000);
        if (child.pid && (command.detached || !exited)) {
          try { killClaudeProcessTree(child.pid); }
          catch { failure ??= new ClaudeCliError("Claude process cleanup failed. Nothing was accepted; check the installed runtime."); }
        }
      };
      const stop = (message: string) => {
        if (failure) return;
        failure = new ClaudeCliError(message);
        cleanup();
      };
      const abort = () => stop("Claude request cancelled. Refresh saved results before retrying.");
      const timer = setTimeout(() => stop("Claude timed out. Refresh saved results before an explicit retry."), timeoutMs);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      const collect = (chunk: Buffer, target: "stdout" | "stderr") => {
        bytes += chunk.length;
        if (bytes > 150_000) { stop("Claude output exceeded the diagnostic limit. Nothing was accepted."); return; }
        (target === "stdout" ? stdout : stderr).push(chunk);
      };
      child.stdout.on("data", (chunk: Buffer) => collect(chunk, "stdout"));
      child.stderr.on("data", (chunk: Buffer) => collect(chunk, "stderr"));
      child.stdin.on("error", () => stop("Claude input failed. Check the installed runtime and retry explicitly."));
      child.on("error", () => {
        failure ??= new ClaudeCliError("Claude could not start. Check the native executable installation.");
        cleanup();
      });
      child.on("exit", exitCode => {
        exited = true;
        code = exitCode;
        if (!command.detached && code === 127) {
          failure ??= new ClaudeCliError("Claude could not start. Check the native executable installation.");
        }
        cleanup();
      });
      child.on("close", exitCode => { code = exitCode; finish(); });
      child.stdin.end(input);
    });
  } finally { rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); }
}

export const runClaudeProcess = createClaudeProcessRunner();

function decode(text: string): unknown {
  try { return JSON.parse(text); }
  catch { throw new ClaudeCliError("Claude returned invalid diagnostic JSON. Nothing was accepted."); }
}

function failure(result: ProcessResult): never {
  const text = `${result.stdout}\n${result.stderr}`;
  if (/limit|quota|overloaded|rate_limit/i.test(text)) {
    throw new ClaudeCliError("Claude reported a usage or availability limit. Check native Claude usage; no API fallback was attempted.");
  }
  if (/auth|login|log in|sign.in|token|401/i.test(text)) {
    throw new ClaudeCliError("Claude authentication failed or expired. Run claude auth login in your terminal, then check again.");
  }
  throw new ClaudeCliError("Claude refused or failed the diagnostic. Check native Claude for model availability or permissions; nothing was accepted.");
}

export function configuredClaudeExecutable() {
  const filename = process.env.READYSTATE_CLAUDE_EXECUTABLE
    ?? path.join(homedir(), ".local", "bin", process.platform === "win32" ? "claude.exe" : "claude");
  if (!path.isAbsolute(filename) || (process.platform === "win32" && path.extname(filename).toLowerCase() !== ".exe")) {
    throw new ClaudeCliError("Configure an absolute native Claude executable, not a shell command or npm shim.");
  }
  // This is an operator-installed external runtime, never an application asset.
  return existsSync(/* turbopackIgnore: true */ filename)
    && statSync(/* turbopackIgnore: true */ filename).isFile() ? filename : undefined;
}

export class ClaudeCli {
  constructor(
    private readonly executable: string | undefined,
    private readonly enabled = false,
    private readonly runner: ClaudeRunner = runClaudeProcess,
  ) {}

  async status(signal: AbortSignal) {
    if (!this.executable) return { installed: false, authentication: "not-checked" as const, evaluationEnabled: this.enabled };
    const version = await this.runner(this.executable, ["--version"], "", signal);
    if (version.code !== 0) failure(version);
    const match = /^(\d+)\.(\d+)\.(\d+)(?:\s|$)/.exec(version.stdout.trim());
    if (!match || Number(match[1]) !== 2 || Number(match[2]) < 1
      || (Number(match[2]) === 1 && Number(match[3]) < 268)) {
      throw new ClaudeCliError("This evaluation requires Claude Code 2.1.268 or newer in major version 2. Runtime compatibility is not yet qualified.");
    }
    const auth = await this.runner(this.executable, ["auth", "status"], "", signal);
    const parsed = z.object({ loggedIn: z.boolean(), authMethod: z.string() }).safeParse(decode(auth.stdout));
    if (!parsed.success) throw new ClaudeCliError("Claude authentication status was not recognized. Use the native CLI to recover.");
    const authentication = !parsed.data.loggedIn ? "sign-in-required" as const
      : auth.code === 0 && parsed.data.authMethod === "claude.ai" ? "native-subscription" as const
        : "unsupported-authentication" as const;
    return { installed: true, version: match[0].trim(), authentication, evaluationEnabled: this.enabled };
  }

  async diagnostic(model: z.infer<typeof claudeRequestedModelSchema>, signal: AbortSignal) {
    if (!this.enabled) throw new ClaudeCliError("CLI inference is disabled pending subscription-use clarification and review. No model was called.");
    const requestedModel = claudeRequestedModelSchema.parse(model);
    const status = await this.status(signal);
    if (!this.executable || status.authentication !== "native-subscription" || !status.version) {
      throw new ClaudeCliError("Native Claude subscription sign-in is required. Run claude auth login in your terminal; never paste credentials into ReadyState.");
    }
    const result = await this.runner(this.executable, [
      "-p", "--output-format", "json", "--model", requestedModel, "--max-turns", "2",
      "--tools", "", "--disable-slash-commands", "--no-session-persistence",
      "--setting-sources", "", "--settings", '{"disableAllHooks":true}',
      "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
      "--json-schema", JSON.stringify(z.toJSONSchema(diagnosticTurnSchema)),
    ], `${DIAGNOSTIC_CLI_REQUEST}${JSON.stringify(diagnosticTurn)}`, signal);
    if (signal.aborted) throw new ClaudeCliError("Claude request cancelled. Nothing was accepted.");
    if (result.code !== 0) failure(result);
    const envelope = z.object({
      type: z.literal("result"), subtype: z.literal("success"), is_error: z.literal(false),
      structured_output: diagnosticTurnSchema,
      modelUsage: z.record(z.string().min(1).max(200), z.unknown()).optional(),
    }).safeParse(decode(result.stdout));
    if (!envelope.success) {
      const error = z.object({ is_error: z.literal(true) }).safeParse(decode(result.stdout));
      if (error.success) failure(result);
      throw new ClaudeCliError("Claude did not return the exact structured acknowledgement. Nothing was accepted.");
    }
    const reportedModels = Object.keys(envelope.data.modelUsage ?? {});
    return {
      candidate: envelope.data.structured_output,
      evidence: claudeCliEvidenceSchema.parse({
        service: "claude-code", runtimeVersion: status.version, requestedModel, reportedModels,
        modelEvidence: reportedModels.length ? "cli-reported-unverified" : "unavailable",
      }),
    };
  }
}
