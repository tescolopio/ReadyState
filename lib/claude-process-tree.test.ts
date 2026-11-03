import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createClaudeProcessRunner } from "@/lib/claude-cli";

const fixture = path.resolve("scripts", "testing", "claude-process-tree.mjs");
function processIsRunning(pid: number) {
  try {
    process.kill(pid, 0);
    // An orphan zombie has no executable or open descriptors; only init can reap it.
    if (process.platform === "linux" && existsSync(`/proc/${pid}/stat`)) {
      return !/\) Z /.test(readFileSync(`/proc/${pid}/stat`, "utf8"));
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

describe("owned Claude CLI tree (fictional subprocesses, no model)", () => {
  it.each(["stdout", "stderr"].flatMap(stream =>
    ["cancel", "timeout", "leader-exit"].map(mode => ({ stream, mode })),
  ))("settles $mode with an inherited $stream and removes all owned processes", async ({ stream, mode }) => {
    const filename = path.resolve(`.claude-tree-${randomUUID()}.json`);
    const controller = new AbortController();
    const started = Date.now();
    const result = createClaudeProcessRunner(mode === "timeout" ? 3_000 : 10_000)(
      process.execPath, [fixture, mode, filename, stream], "", controller.signal,
    );
    // Attach rejection handling immediately, before waiting for fixture readiness.
    let settled = false;
    const outcome = result.then(value => ({ value, error: undefined }), error => ({ value: undefined, error }))
      .finally(() => { settled = true; });
    let pids: Record<string, number> = {};
    try {
      await expect.poll(() => existsSync(filename), { timeout: 5_000 }).toBe(true);
      pids = JSON.parse(readFileSync(filename, "utf8"));
      if (mode !== "leader-exit") {
        expect(Object.values(pids).every(processIsRunning)).toBe(true);
      }
      if (mode === "cancel") controller.abort();
      await expect.poll(() => settled, { timeout: mode === "timeout" ? 5_000 : 2_000 }).toBe(true);
      const completed = await outcome;
      expect(Date.now() - started).toBeLessThan(mode === "timeout" ? 5_000 : 6_000);
      if (mode === "leader-exit") {
        expect(completed.error).toBeUndefined();
        expect(completed.value).toMatchObject({ code: 0, stdout: "leader completed\n" });
      } else {
        expect(completed.error).toMatchObject({ message: expect.stringContaining(mode === "cancel" ? "cancelled" : "timed out") });
      }
      await expect.poll(() => Object.values(pids).filter(processIsRunning), { timeout: 3_000 }).toEqual([]);
    } finally {
      controller.abort();
      // Failure cleanup is restricted to fixture PIDs, never process names.
      for (const pid of Object.values(pids)) {
        if (processIsRunning(pid)) process.kill(pid, "SIGKILL");
      }
      try {
        await expect.poll(() => settled, { timeout: 3_000 }).toBe(true);
        await outcome;
      } finally { rmSync(filename, { force: true }); }
    }
  }, 15_000);
});
