import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { inspectPackage } from "./inspect.mjs";

describe("extracted package inspection", () => {
  it("rejects developer environment files, evaluation output and credentials", () => {
    for (const name of [".env.local", ".env", ".npmrc", "eval-results", "trace.log", "private.pem", "fixture.test.ts"]) {
      const root = mkdtempSync(path.join(tmpdir(), "readystate-content-"));
      try {
        writeFileSync(path.join(root, name), "synthetic");
        expect(() => inspectPackage(root)).toThrow("Forbidden package path");
      } finally { rmSync(root, { recursive: true }); }
    }
  });
  it("detects a captured key without including its value in the error", () => {
    const root = mkdtempSync(path.join(tmpdir(), "readystate-content-"));
    try {
      const canary = "synthetic-package-credential-canary";
      mkdirSync(path.join(root, "app"));
      writeFileSync(path.join(root, "app", "bundle.js"), canary);
      expect(() => inspectPackage(root, [canary])).toThrow("Captured environment value");
      try { inspectPackage(root, [canary]); } catch (error) {
        expect(String(error)).not.toContain(canary);
      }
    } finally { rmSync(root, { recursive: true }); }
  });
  it("rejects credential signatures but permits empty configuration examples", () => {
    const root = mkdtempSync(path.join(tmpdir(), "readystate-content-"));
    try {
      writeFileSync(path.join(root, "configuration.example"), "GROQ_API_KEY=\n");
      expect(inspectPackage(root)).toBe(1);
      writeFileSync(path.join(root, "configuration.example"), `GROQ_API_KEY=gsk_${"a".repeat(48)}`);
      expect(() => inspectPackage(root)).toThrow("Credential-shaped content");
    } finally { rmSync(root, { recursive: true }); }
  });
});
