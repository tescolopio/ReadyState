import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { inspectPackage } from "./inspect.mjs";

describe("extracted package inspection", () => {
  it("checks separately assembled public and static asset trees", () => {
    for (const directory of ["public", ".next/static"]) {
      const root = mkdtempSync(path.join(tmpdir(), "readystate-assets-"));
      try {
        const assets = path.join(root, directory);
        mkdirSync(assets, { recursive: true });
        writeFileSync(path.join(assets, "bundle.js"), `sk-${"a".repeat(48)}`);
        expect(() => inspectPackage(root)).toThrow("Credential-shaped content");
        rmSync(path.join(assets, "bundle.js"));
        writeFileSync(path.join(assets, "package-canary.pem"), "synthetic");
        expect(() => inspectPackage(root)).toThrow("Forbidden package path");
      } finally { rmSync(root, { recursive: true }); }
    }
  });
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
  it("fails when the disabled native or WASM image stack returns", () => {
    for (const name of ["sharp", "sharp-win32-x64", "sharp-libvips-linux-x64", "sharp-wasm32", "libvips-cpp.so"]) {
      const root = mkdtempSync(path.join(tmpdir(), "readystate-content-"));
      try {
        mkdirSync(path.join(root, name));
        expect(() => inspectPackage(root)).toThrow("Unused image-processing dependency returned");
      } finally { rmSync(root, { recursive: true }); }
    }
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
  it("does not confuse embedded SVG mask-size property names with key tokens", () => {
    const root = mkdtempSync(path.join(tmpdir(), "readystate-content-"));
    try {
      writeFileSync(path.join(root, "image.wasm"), `\0mask-size${"unicode".repeat(20)}-bidizfont-variant\0`);
      expect(inspectPackage(root)).toBe(1);
      writeFileSync(path.join(root, "image.wasm"), `\0sk-${"a".repeat(48)}\0`);
      expect(() => inspectPackage(root)).toThrow("Credential-shaped content");
    } finally { rmSync(root, { recursive: true }); }
  });
});
