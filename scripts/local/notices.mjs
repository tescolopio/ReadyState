import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const readJson = file => JSON.parse(readFileSync(file, "utf8"));
const portable = value => value.split(path.sep).join("/");
const digest = file => createHash("sha256").update(readFileSync(file)).digest("hex");

function applicationDependencies(projectRoot) {
  const found = new Map();
  const resolve = (name, from, optional = false) => {
    let current = from;
    while (true) {
      const directory = path.join(current, "node_modules", name);
      if (existsSync(path.join(directory, "package.json"))) {
        const physical = realpathSync(directory);
        if (found.has(physical)) return;
        const metadata = readJson(path.join(physical, "package.json"));
        found.set(physical, metadata);
        for (const dependency of Object.keys(metadata.dependencies ?? {})) {
          resolve(dependency, physical, dependency in (metadata.optionalDependencies ?? {}));
        }
        for (const peer of Object.keys(metadata.peerDependencies ?? {})) {
          // Type declarations do not enter executable application bundles.
          if (!peer.startsWith("@types/")) resolve(peer, physical, metadata.peerDependenciesMeta?.[peer]?.optional === true);
        }
        return;
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    if (!optional) throw new Error(`Missing application dependency for notices: ${name} from ${from}`);
  };
  const project = readJson(path.join(projectRoot, "package.json"));
  for (const name of Object.keys(project.dependencies ?? {})) resolve(name, projectRoot);
  return found;
}

export function copyNotices(destination, projectRoot = process.cwd()) {
  projectRoot = realpathSync(projectRoot);
  const source = path.join(projectRoot, "node_modules");
  const app = path.dirname(destination);
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const supplements = readJson(path.join(scriptDirectory, "license-supplements.json"));
  const notices = [];
  const originals = new Map();
  const collect = (original, directory, relative, scope) => {
      const physical = realpathSync(original);
      if (originals.has(physical)) {
        originals.get(physical).scopes.push(scope);
        return;
      }
      const metadata = readJson(path.join(original, "package.json"));
      mkdirSync(directory, { recursive: true });
      const files = readdirSync(original, { withFileTypes: true }).filter(entry =>
        entry.isFile() && /^(licen[cs]e|notice|copying|copyright)([.-].*)?$/i.test(entry.name));
      for (const entry of files) cpSync(path.join(original, entry.name), path.join(directory, entry.name));
      let noticeSource = "installed dependency";
      let redistributionReview = null;
      const noticeFiles = files.map(entry => entry.name);
      const supplement = supplements.find(item => item.name === metadata.name &&
        item.version === (metadata.version ?? null) && item.license === metadata.license);
      if (!noticeFiles.length) {
        if (metadata.name === "@next/env") {
          const next = readJson(path.join(source, "next", "package.json"));
          if (next.version !== metadata.version || next.license !== metadata.license) throw new Error("Next env/root license version mismatch.");
          cpSync(path.join(source, "next", "license.md"), path.join(directory, "LICENSE.upstream.txt"));
          noticeSource = `https://github.com/vercel/next.js/blob/v${next.version}/license.md`;
        } else if (supplement) {
          cpSync(path.join(scriptDirectory, "licenses", supplement.file), path.join(directory, "LICENSE.upstream.txt"));
          noticeSource = supplement.source;
        } else {
          throw new Error(`Unreviewed missing license notice: ${metadata.name ?? relative}@${metadata.version ?? "unknown"}`);
        }
        noticeFiles.push("LICENSE.upstream.txt");
      }
      if (supplement?.additionalFiles) {
        for (const file of supplement.additionalFiles) {
          cpSync(path.join(scriptDirectory, "licenses", file), path.join(directory, file));
          noticeFiles.push(file);
        }
        redistributionReview = supplement.redistributionReview ?? null;
        if (existsSync(path.join(original, "versions.json"))) cpSync(path.join(original, "versions.json"), path.join(directory, "versions.json"));
      }
      const record = { name: metadata.name ?? relative, version: metadata.version ?? null, license: metadata.license ?? null,
        path: portable(relative), noticeDirectory: portable(path.relative(app, directory)), scopes: [scope],
        notices: noticeFiles, noticeHashes: Object.fromEntries(noticeFiles.map(file => [file, digest(path.join(directory, file))])),
        noticeSource, supplementalNoticeSource: supplement?.noticeSource ?? null, redistributionReview };
      notices.push(record);
      originals.set(physical, record);
  };
  const walk = directory => {
    const relative = path.relative(destination, directory);
    const original = path.join(source, relative);
    if (existsSync(path.join(directory, "package.json"))) {
      if (!existsSync(original)) throw new Error(`Missing dependency source for notices: ${relative}`);
      collect(original, directory, relative, "traced-server");
    }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(directory, entry.name));
    }
  };
  walk(destination);
  for (const original of applicationDependencies(projectRoot).keys()) {
    const relative = path.relative(source, original);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Application notice source is outside node_modules: ${original}`);
    collect(original, path.join(app, "THIRD-PARTY-LICENSES", relative), relative, "application-dependency");
  }
  writeFileSync(path.join(app, "THIRD-PARTY.json"), JSON.stringify(notices, null, 2));
  verifyNotices(app, projectRoot);
  return notices;
}

export function verifyNotices(app, projectRoot = process.cwd()) {
  const inventory = readJson(path.join(app, "THIRD-PARTY.json"));
  if (!inventory.length) throw new Error("Missing dependency notice inventory");
  for (const record of inventory) {
    if (!record.notices?.length) throw new Error(`Missing license materials: ${record.name}`);
    const directory = path.resolve(app, record.noticeDirectory);
    const relative = path.relative(app, directory);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Notice directory escapes application: ${record.name}`);
    for (const file of record.notices) {
      if (path.basename(file) !== file) throw new Error(`Invalid notice filename: ${file}`);
      const full = path.join(directory, file);
      if (!existsSync(full) || digest(full) !== record.noticeHashes?.[file]) throw new Error(`Missing or changed notice: ${record.name}/${file}`);
    }
  }
  const source = path.join(realpathSync(projectRoot), "node_modules");
  for (const [original, metadata] of applicationDependencies(realpathSync(projectRoot))) {
    const record = inventory.find(item => item.path === portable(path.relative(source, original)) &&
      item.name === metadata.name && item.version === (metadata.version ?? null) && item.scopes?.includes("application-dependency"));
    if (!record) throw new Error(`Missing application dependency attribution: ${metadata.name}@${metadata.version}`);
    for (const entry of readdirSync(original, { withFileTypes: true }).filter(entry =>
      entry.isFile() && /^(licen[cs]e|notice|copying|copyright)([.-].*)?$/i.test(entry.name))) {
      if (!record.notices.includes(entry.name) || record.noticeHashes[entry.name] !== digest(path.join(original, entry.name))) throw new Error(`Installed-version attribution mismatch: ${metadata.name}/${entry.name}`);
    }
  }
  return inventory;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error("Specify the standalone node_modules directory.");
  copyNotices(path.resolve(process.argv[2]));
}
