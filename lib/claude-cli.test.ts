import { afterEach, describe, expect, it, vi } from "vitest";
import { ClaudeCli, claudeEnvironment, configuredClaudeExecutable, runClaudeProcess, type ClaudeRunner } from "@/lib/claude-cli";
import { diagnosticTurn } from "@/lib/connection-diagnostic.mjs";

const signal = () => new AbortController().signal;
const success = (value: unknown) => ({ code: 0, stdout: JSON.stringify(value), stderr: "" });
function runner() {
  return vi.fn<ClaudeRunner>()
    .mockResolvedValueOnce({ code: 0, stdout: "2.1.300 (Claude Code)\n", stderr: "" })
    .mockResolvedValueOnce(success({ loggedIn: true, authMethod: "claude.ai", email: "not-retained" }))
    .mockResolvedValueOnce(success({
      type: "result", subtype: "success", is_error: false, structured_output: diagnosticTurn,
      modelUsage: { "claude-sonnet-example": { costUSD: 123 } },
    }));
}
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("official Claude CLI diagnostic adapter (no live model)", () => {
  it("does not execute anything when inference is disabled", async () => {
    const execute = runner();
    await expect(new ClaudeCli("native-executable", false, execute).diagnostic("sonnet", signal())).rejects.toThrow("disabled");
    expect(execute).not.toHaveBeenCalled();
  });
  it("reports missing runtime without executing a shell", async () => {
    const execute = runner();
    expect(await new ClaudeCli(undefined, false, execute).status(signal())).toMatchObject({
      installed: false, authentication: "not-checked", evaluationEnabled: false,
    });
    expect(execute).not.toHaveBeenCalled();
  });
  it("refuses relative executable commands and Windows shell shims", () => {
    vi.stubEnv("READYSTATE_CLAUDE_EXECUTABLE", "claude --print");
    expect(() => configuredClaudeExecutable()).toThrow("absolute native");
    if (process.platform === "win32") {
      vi.stubEnv("READYSTATE_CLAUDE_EXECUTABLE", "C:\\fictional\\claude.cmd");
      expect(() => configuredClaudeExecutable()).toThrow("absolute native");
    }
  });
  it("uses fixed content, restricted CLI flags and distinct persisted model evidence", async () => {
    const execute = runner();
    const result = await new ClaudeCli("native-executable", true, execute).diagnostic("sonnet", signal());
    expect(result.candidate).toEqual(diagnosticTurn);
    expect(result.evidence).toEqual({
      service: "claude-code", runtimeVersion: "2.1.300", requestedModel: "sonnet",
      reportedModels: ["claude-sonnet-example"], modelEvidence: "cli-reported-unverified",
    });
    const [, args, prompt] = execute.mock.calls[2];
    expect(args).toEqual(expect.arrayContaining([
      "-p", "--tools", "", "--no-session-persistence", "--setting-sources",
      "--strict-mcp-config", "--disable-slash-commands", '{"disableAllHooks":true}',
    ]));
    expect(args).not.toContain("--bare");
    expect(args).not.toContain("--dangerously-skip-permissions");
    expect(args).not.toContain("--fallback-model");
    expect(prompt).toContain(JSON.stringify(diagnosticTurn));
    expect(prompt).not.toContain("not-retained");
  });
  it("marks absent response model evidence as unavailable", async () => {
    const execute = vi.fn<ClaudeRunner>()
      .mockResolvedValueOnce({ code: 0, stdout: "2.1.300", stderr: "" })
      .mockResolvedValueOnce(success({ loggedIn: true, authMethod: "claude.ai" }))
      .mockResolvedValueOnce(success({ type: "result", subtype: "success", is_error: false, structured_output: diagnosticTurn }));
    expect((await new ClaudeCli("native", true, execute).diagnostic("opus", signal())).evidence).toMatchObject({
      requestedModel: "opus", reportedModels: [], modelEvidence: "unavailable",
    });
  });
  it.each(["api_key", "oauth_token", "api_key_helper", "third_party", "none"])("refuses %s authentication without inference or fallback", async method => {
    const execute = vi.fn<ClaudeRunner>()
      .mockResolvedValueOnce({ code: 0, stdout: "2.1.300", stderr: "" })
      .mockResolvedValueOnce(success({ loggedIn: true, authMethod: method }));
    await expect(new ClaudeCli("native", true, execute).diagnostic("haiku", signal())).rejects.toThrow("sign-in");
    expect(execute).toHaveBeenCalledTimes(2);
  });
  it("reports logged-out status and refuses inference", async () => {
    const execute = vi.fn<ClaudeRunner>()
      .mockResolvedValueOnce({ code: 0, stdout: "2.1.300", stderr: "" })
      .mockResolvedValueOnce({ code: 1, stdout: '{"loggedIn":false,"authMethod":"none"}', stderr: "" });
    expect(await new ClaudeCli("native", false, execute).status(signal())).toMatchObject({ authentication: "sign-in-required" });
  });
  it.each(["2.1.267", "3.0.0", "unrecognized"])("refuses unqualified runtime %s", async version => {
    const execute = vi.fn<ClaudeRunner>().mockResolvedValue({ code: 0, stdout: version, stderr: "" });
    await expect(new ClaudeCli("native", false, execute).status(signal())).rejects.toThrow("requires Claude Code");
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it.each([
    { code: 1, stdout: "", stderr: "401 authentication expired SECRET", message: "authentication failed" },
    { code: 1, stdout: "", stderr: "rate_limit SECRET", message: "usage or availability limit" },
    { code: 1, stdout: "", stderr: "unavailable model SECRET", message: "refused or failed" },
    { code: 0, stdout: "invalid SECRET", stderr: "", message: "invalid diagnostic JSON" },
    { code: 0, stdout: JSON.stringify({ type: "result", subtype: "success", is_error: false, structured_output: { ...diagnosticTurn, hours_elapsed: 1 } }), stderr: "", message: "exact structured acknowledgement" },
    { code: 0, stdout: JSON.stringify({ is_error: true, result: "usage limit SECRET" }), stderr: "", message: "usage or availability limit" },
  ])("returns an explicit safe error for $message", async ({ message, ...output }) => {
    const execute = runner();
    execute.mockReset()
      .mockResolvedValueOnce({ code: 0, stdout: "2.1.300", stderr: "" })
      .mockResolvedValueOnce(success({ loggedIn: true, authMethod: "claude.ai" }))
      .mockResolvedValueOnce(output);
    await expect(new ClaudeCli("native", true, execute).diagnostic("sonnet", signal())).rejects.toThrow(message);
    expect(execute).toHaveBeenCalledTimes(3);
  });
  it("does not inherit provider credentials, endpoints, tokens or node injection", () => {
    expect(claudeEnvironment({
      PATH: "path", USERPROFILE: "home", ANTHROPIC_API_KEY: "secret", CLAUDE_CODE_OAUTH_TOKEN: "secret",
      ANTHROPIC_BASE_URL: "https://other.invalid", NODE_OPTIONS: "--require unsafe", READY_STATE_SECRET: "secret",
    })).toEqual({ PATH: "path", USERPROFILE: "home", NODE_ENV: "production" });
  });
  it("executes a bounded subprocess outside the repository", async () => {
    const result = await runClaudeProcess(process.execPath, ["-e",
      "process.stdin.resume(); process.stdin.on('end',()=>console.log(JSON.stringify({cwd:process.cwd(),secret:process.env.ANTHROPIC_API_KEY})))",
    ], "fictional input", signal());
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ cwd: expect.stringContaining("readystate-claude-") });
    expect(result.stdout).not.toContain("secret");
  });
  it("terminates an owned subprocess on cancellation", async () => {
    const controller = new AbortController();
    const result = runClaudeProcess(process.execPath, ["-e", "setInterval(()=>{},1000)"], "", controller.signal);
    controller.abort();
    await expect(result).rejects.toThrow("cancelled");
  });
  it("refuses a pre-cancelled invocation without starting a process", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(runClaudeProcess("not-an-executable", [], "", controller.signal)).rejects.toThrow("cancelled");
  });
  it("returns an explicit missing-executable failure", async () => {
    await expect(runClaudeProcess("readystate-fictional-missing-executable", [], "", signal())).rejects.toThrow("could not start");
  });
  it("terminates an owned subprocess at its deadline", async () => {
    vi.useFakeTimers();
    const result = runClaudeProcess(process.execPath, ["-e", "setInterval(()=>{},1000)"], "", signal());
    const assertion = expect(result).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(91_001);
    await assertion;
  });
  it("refuses oversized output", async () => {
    await expect(runClaudeProcess(process.execPath, ["-e", "process.stdout.write('x'.repeat(160000));setInterval(()=>{},1000)"], "", signal()))
      .rejects.toThrow("exceeded");
  });
});
