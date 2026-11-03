import { EventEmitter, getEventListeners } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createClaudeProcessRunner } from "@/lib/claude-cli";

const { spawn, killTree } = vi.hoisted(() => ({ spawn: vi.fn(), killTree: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn }));
vi.mock("@/lib/claude-owned-process", () => ({
  claudeProcessCommand: (executable: string, args: string[]) => ({ executable, args, detached: true }),
  killClaudeProcessTree: killTree,
}));
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe("bounded settlement when owned pipes never emit close", () => {
  it.each(["cancel", "timeout", "leader-exit", "kill-failure", "spawn-error"])("settles %s without waiting for close", async mode => {
    vi.useFakeTimers();
    const child = Object.assign(new EventEmitter(), {
      pid: 12345, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    });
    spawn.mockReturnValue(child);
    if (mode === "kill-failure") killTree.mockImplementationOnce(() => { throw new Error("fixture cleanup refused"); });
    const controller = new AbortController();
    const pending = createClaudeProcessRunner(90_000)("fictional-executable", [], "", controller.signal);
    const outcome = pending.then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
    if (mode === "cancel") controller.abort();
    else if (mode === "spawn-error") child.emit("error", new Error("fixture start failed"));
    else if (mode !== "timeout") child.emit("exit", 0);
    await vi.advanceTimersByTimeAsync(mode === "timeout" ? 91_000 : 1_000);
    const result = await outcome;
    expect(result.value).toBeUndefined();
    expect(result.error).toMatchObject({ message: expect.stringContaining(
      mode === "cancel" ? "cancelled" : mode === "timeout" ? "timed out"
        : mode === "kill-failure" ? "cleanup failed" : mode === "spawn-error" ? "could not start" : "streams did not close",
    ) });
    expect(killTree).toHaveBeenCalledExactlyOnceWith(12345);
    expect(child.stdin.destroyed && child.stdout.destroyed && child.stderr.destroyed).toBe(true);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    child.emit("close", 0);
  });
});
