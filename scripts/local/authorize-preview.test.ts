import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sha = "a".repeat(40);
const otherSha = "b".repeat(40);
const guard = resolve("scripts/local/authorize-preview.ps1");
const shell = process.platform === "win32" ? "powershell.exe" : "pwsh";
const probe = spawnSync(shell, ["-NoProfile", "-NonInteractive", "-Command", "exit 0"], { encoding: "utf8" });
const unavailable = Boolean(probe.error && "code" in probe.error && probe.error.code === "ENOENT");
if (probe.error && !unavailable) throw probe.error;
if (!unavailable && probe.status !== 0) throw new Error(`PowerShell probe failed: ${probe.stderr}`);
if (unavailable) console.warn("Skipping preview upload guard tests: PowerShell is not installed. Native package CI must run these with PowerShell.");
const command = `
function git {
  $global:LASTEXITCODE = 0
  if ($args[0] -eq 'rev-parse') { return $env:TEST_CHECKOUT_SHA }
  if ($args[0] -eq 'ls-remote') {
    if ($env:TEST_REMOTE_FAILURE -eq 'true') { $global:LASTEXITCODE = 1; return }
    return "$($env:TEST_LIVE_SHA)\`trefs/heads/main"
  }
  throw 'Unexpected git command'
}
& $env:TEST_GUARD
`;

describe.skipIf(unavailable)("authorized preview upload scope (requires PowerShell)", () => {
  it.each([
    { name: "exact reviewed live main", allowed: true },
    { name: "another branch", ref: "refs/heads/preview", allowed: false },
    { name: "distinct Main branch", ref: "refs/heads/Main", allowed: false },
    { name: "distinct MAIN branch", ref: "refs/heads/MAIN", allowed: false },
    { name: "another tag", tag: "v1.0.0", allowed: false },
    { name: "differently cased tag", tag: "V0.1.0-PREVIEW.1", allowed: false },
    { name: "malformed revision", revision: "short", allowed: false },
    { name: "different checkout", checkout: otherSha, allowed: false },
    { name: "old dispatch after main moved", live: otherSha, allowed: false },
    { name: "failed live-main lookup", remoteFailure: true, allowed: false },
  ])("$name", (scenario) => {
    const result = spawnSync(shell, ["-NoProfile", "-NonInteractive", "-Command", command], {
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_REF: scenario.ref ?? "refs/heads/main",
        PREVIEW_TAG: scenario.tag ?? "v0.1.0-preview.1",
        SOURCE_REVISION: scenario.revision ?? sha,
        TEST_CHECKOUT_SHA: scenario.checkout ?? sha,
        TEST_LIVE_SHA: scenario.live ?? sha,
        TEST_REMOTE_FAILURE: String(scenario.remoteFailure ?? false),
        TEST_GUARD: guard,
      },
    });
    expect(result.error).toBeUndefined();
    if (scenario.allowed) {
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
    } else {
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/Preview uploads require|authorized tester|full reviewed|differs|Main moved|Cannot verify live main/);
    }
  }, 15_000);
});
