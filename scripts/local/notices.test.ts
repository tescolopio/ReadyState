import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyNotices, verifyNotices } from "./notices.mjs";

let root: string;
let app: string;
function dependency(name: string, dependencies: Record<string, string> = {}, parent = root) {
  const directory = path.join(parent, "node_modules", name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, "package.json"), JSON.stringify({ name, version: "1.2.3", license: "MIT", dependencies }));
  writeFileSync(path.join(directory, "LICENSE"), `MIT permission text and Copyright ${name} installed 1.2.3`);
  return directory;
}
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "readystate-notices-"));
  app = path.join(root, "output", "app");
  mkdirSync(path.join(app, "node_modules"), { recursive: true });
  mkdirSync(path.join(app, ".next", "static"), { recursive: true });
  writeFileSync(path.join(app, ".next", "static", "bundle.js"), "compiled application uses zustand and bundled-child");
  writeFileSync(path.join(root, "package.json"), JSON.stringify({
    dependencies: { zustand: "1.2.3", "traced-server": "1.2.3" },
    devDependencies: { "test-only": "1.2.3" },
  }));
  dependency("zustand", { "bundled-child": "1.2.3" });
  dependency("bundled-child");
  dependency("test-only");
  const traced = dependency("traced-server");
  cpSync(traced, path.join(app, "node_modules", "traced-server"), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true }));

describe("bundled application notices", () => {
  it("includes installed-version client and transitive licenses without copying dependency code or dev dependencies", () => {
    const records = copyNotices(path.join(app, "node_modules"), root);
    const client = records.find(record => record.name === "zustand");
    expect(client?.version).toBe("1.2.3");
    expect(client?.scopes).toEqual(["application-dependency"]);
    expect(readFileSync(path.join(app, client!.noticeDirectory, "LICENSE"))).toEqual(readFileSync(path.join(root, "node_modules", "zustand", "LICENSE")));
    expect(readFileSync(path.join(app, client!.noticeDirectory, "LICENSE"), "utf8")).toContain("Copyright zustand installed 1.2.3");
    expect(records.some(record => record.name === "bundled-child")).toBe(true);
    expect(records.some(record => record.name === "test-only")).toBe(false);
    expect(records.filter(record => record.name === "traced-server")).toHaveLength(1);
    expect(records.find(record => record.name === "traced-server")?.scopes).toEqual(["traced-server", "application-dependency"]);
    expect(() => readFileSync(path.join(app, client!.noticeDirectory, "package.json"))).toThrow();
    expect(verifyNotices(app, root)).toHaveLength(3);
  });
  it("rejects removal of a client-bundle attribution record even when every server notice remains", () => {
    const records = copyNotices(path.join(app, "node_modules"), root);
    writeFileSync(path.join(app, "THIRD-PARTY.json"), JSON.stringify(records.filter(record => record.name !== "zustand")));
    expect(() => verifyNotices(app, root)).toThrow("Missing application dependency attribution: zustand@1.2.3");
  });
  it("rejects absent or changed client license text in the extracted payload", () => {
    const record = copyNotices(path.join(app, "node_modules"), root).find(record => record.name === "zustand")!;
    const license = path.join(app, record.noticeDirectory, "LICENSE");
    writeFileSync(license, "Generic MIT text without this dependency's copyright");
    expect(() => verifyNotices(app, root)).toThrow("Missing or changed notice: zustand/LICENSE");
    rmSync(license);
    expect(() => verifyNotices(app, root)).toThrow("Missing or changed notice: zustand/LICENSE");
  });
  it("copies upstream NOTICE files and fails on a new dependency without reviewed license materials", () => {
    writeFileSync(path.join(root, "node_modules", "bundled-child", "NOTICE"), "Installed child attribution");
    const records = copyNotices(path.join(app, "node_modules"), root);
    expect(records.find(record => record.name === "bundled-child")?.notices).toEqual(["LICENSE", "NOTICE"]);
    rmSync(path.join(root, "node_modules", "bundled-child", "LICENSE"));
    rmSync(path.join(root, "node_modules", "bundled-child", "NOTICE"));
    expect(() => copyNotices(path.join(app, "node_modules"), root)).toThrow("Unreviewed missing license notice: bundled-child@1.2.3");
  });
  it("fails closed when a required dependency is missing, rather than reporting complete coverage", () => {
    rmSync(path.join(root, "node_modules", "bundled-child"), { recursive: true });
    expect(() => copyNotices(path.join(app, "node_modules"), root)).toThrow("Missing application dependency for notices: bundled-child");
  });
  it("rejects dropping an installed NOTICE from the list even if its recorded hash survives", () => {
    writeFileSync(path.join(root, "node_modules", "zustand", "NOTICE"), "Additional copyright");
    const records = copyNotices(path.join(app, "node_modules"), root);
    const client = records.find(record => record.name === "zustand")!;
    client.notices = client.notices.filter((file: string) => file !== "NOTICE");
    writeFileSync(path.join(app, "THIRD-PARTY.json"), JSON.stringify(records));
    expect(() => verifyNotices(app, root)).toThrow("Installed-version attribution mismatch: zustand/NOTICE");
  });
  it("resolves nested installed versions and optional peers without including platform optional build dependencies", () => {
    const parent = path.join(root, "node_modules", "zustand");
    dependency("bundled-child", {}, parent);
    dependency("runtime-peer");
    writeFileSync(path.join(parent, "package.json"), JSON.stringify({
      name: "zustand", version: "1.2.3", license: "MIT", dependencies: { "bundled-child": "1.2.3" },
      peerDependencies: { "runtime-peer": "*", "absent-optional": "*", "@types/react": "*" },
      peerDependenciesMeta: { "absent-optional": { optional: true } },
      optionalDependencies: { "build-platform": "*" },
    }));
    const records = copyNotices(path.join(app, "node_modules"), root);
    expect(records.find(record => record.name === "bundled-child")?.path).toBe("zustand/node_modules/bundled-child");
    expect(records.some(record => record.name === "runtime-peer")).toBe(true);
    expect(records.some(record => record.name === "build-platform")).toBe(false);
  });
});
