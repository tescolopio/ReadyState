import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function copyNotices(destination) {
  const source = path.join(process.cwd(), "node_modules");
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const supplements = JSON.parse(readFileSync(path.join(scriptDirectory, "license-supplements.json"), "utf8"));
  const notices = [];
  const walk = directory => {
    const relative = path.relative(destination, directory);
    const original = path.join(source, relative);
    if (existsSync(path.join(directory, "package.json"))) {
      const metadata = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8"));
      if (!existsSync(original)) throw new Error(`Missing dependency source for notices: ${relative}`);
      const files = readdirSync(original, { withFileTypes: true }).filter(entry =>
        entry.isFile() && /^(licen[cs]e|notice|copying|copyright)([.-].*)?$/i.test(entry.name));
      for (const entry of files) cpSync(path.join(original, entry.name), path.join(directory, entry.name));
      let noticeSource = "installed dependency";
      const noticeFiles = files.map(entry => entry.name);
      if (!noticeFiles.length) {
        const supplement = supplements.find(item => item.name === metadata.name &&
          item.version === (metadata.version ?? null) && item.license === metadata.license);
        if (metadata.name === "@next/env") {
          const next = JSON.parse(readFileSync(path.join(source, "next", "package.json"), "utf8"));
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
      notices.push({ name: metadata.name ?? relative, version: metadata.version ?? null, license: metadata.license ?? null, path: relative.split(path.sep).join("/"), notices: noticeFiles, noticeSource });
    }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(directory, entry.name));
    }
  };
  walk(destination);
  writeFileSync(path.join(path.dirname(destination), "THIRD-PARTY.json"), JSON.stringify(notices, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error("Specify the standalone node_modules directory.");
  copyNotices(path.resolve(process.argv[2]));
}
