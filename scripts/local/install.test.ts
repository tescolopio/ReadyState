import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("per-user installer ownership", () => {
  it.skipIf(process.platform !== "linux")("rejects nested physical paths and removes only the exact shortcut through aliases", () => {
    const root = mkdtempSync(path.join(tmpdir(), "readystate-installer-"));
    const source = path.join(root, "source");
    const alias = path.join(root, "source-alias");
    const home = path.join(root, "home");
    const installed = path.join(home, "ReadyState installed");
    const shortcut = path.join(home, ".local", "share", "applications", "readystate.desktop");
    try {
      mkdirSync(path.join(source, "runtime"), { recursive: true });
      mkdirSync(home);
      writeFileSync(path.join(source, "runtime", "node"), "synthetic runtime");
      writeFileSync(path.join(source, "release.json"), JSON.stringify({ source: "https://github.com/tescolopio/ReadyState/tree/synthetic" }));
      for (const file of ["install.sh", "uninstall.sh", "start.sh"]) cpSync(path.resolve("scripts/local", file), path.join(source, file));
      symlinkSync(source, alias);
      const env = { ...process.env, HOME: home };
      const nested = path.join(source, "nested");
      expect(() => execFileSync("sh", [path.join(alias, "install.sh"), nested], { env, stdio: "pipe" })).toThrow();
      expect(existsSync(nested)).toBe(false);
      execFileSync("sh", [path.join(alias, "install.sh"), installed], { env, stdio: "pipe" });
      symlinkSync(installed, path.join(root, "installed-alias"));
      const siblingEntry = `Exec=sh "${installed}-new/start.sh"\n`;
      writeFileSync(shortcut, siblingEntry);
      execFileSync("sh", [path.join(root, "installed-alias", "uninstall.sh")], { env, stdio: "pipe" });
      expect(readFileSync(shortcut, "utf8")).toBe(siblingEntry);
      writeFileSync(shortcut, `Exec=sh "${installed}/start.sh"\n`);
      execFileSync("sh", [path.join(root, "installed-alias", "uninstall.sh")], { env, stdio: "pipe" });
      expect(existsSync(shortcut)).toBe(false);
    } finally { rmSync(root, { recursive: true }); }
  });

  it.skipIf(process.platform !== "win32")("preserves a sibling or different-executable shortcut and removes the exact owned Windows shortcut", () => {
    const root = mkdtempSync(path.join(tmpdir(), "readystate-shortcut-"));
    const installation = path.join(root, "ReadyState");
    try {
      mkdirSync(installation);
      writeFileSync(path.join(installation, "start.ps1"), "# synthetic launch fixture");
      writeFileSync(path.join(installation, "release.json"), JSON.stringify({ source: "https://github.com/tescolopio/ReadyState/tree/synthetic" }));
      cpSync(path.resolve("scripts/local/uninstall.ps1"), path.join(installation, "uninstall.ps1"));
      const script = `
$ErrorActionPreference = 'Stop'
$installation = $env:READYSTATE_TEST_INSTALLATION
$shortcutPath = Join-Path ([Environment]::GetFolderPath('Programs')) 'ReadyState.lnk'
if (Test-Path -LiteralPath $shortcutPath) { throw 'Refusing to replace an existing user shortcut in test' }
$expectedExe = "$env:SystemRoot\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
$shell = New-Object -ComObject WScript.Shell
try {
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $expectedExe
  $shortcut.Arguments = "-NoProfile -NoExit -File \`"$installation-new\\start.ps1\`""
  $shortcut.Save()
  & "$installation\\uninstall.ps1"
  if (!(Test-Path -LiteralPath $shortcutPath)) { throw 'Sibling shortcut removed' }
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = "$env:SystemRoot\\System32\\notepad.exe"
  $shortcut.Arguments = "-NoProfile -NoExit -File \`"$installation\\start.ps1\`""
  $shortcut.Save()
  & "$installation\\uninstall.ps1"
  if (!(Test-Path -LiteralPath $shortcutPath)) { throw 'Different executable shortcut removed' }
  $shortcut.TargetPath = $expectedExe
  $shortcut.Save()
  & "$installation\\uninstall.ps1"
  if (Test-Path -LiteralPath $shortcutPath) {
    $actual = $shell.CreateShortcut($shortcutPath)
    throw ("Owned shortcut not removed; executable={0}; arguments={1}; expected installation={2}" -f $actual.TargetPath,$actual.Arguments,$installation)
  }
} finally {
  if (Test-Path -LiteralPath $shortcutPath) {
    $shortcut = $shell.CreateShortcut($shortcutPath)
    if ($shortcut.Arguments.Contains($installation)) { Remove-Item -LiteralPath $shortcutPath }
  }
}`;
      execFileSync("powershell.exe", ["-NoProfile", "-Command", script], {
        env: { ...process.env, READYSTATE_TEST_INSTALLATION: installation },
        stdio: "pipe",
      });
    } finally { rmSync(root, { recursive: true }); }
  });
});
