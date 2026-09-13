// Copyright (c) 2026 Rish
// SPDX-License-Identifier: GPL-3.0-or-later
// See LICENSE and LICENSING.md for licensing and warranty information.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { dependencies, notices } = require("./third-party-notices");

function sourceFiles(root) {
  const manifest = path.join(root, "SOURCE_FILES.json");
  if (fs.existsSync(manifest)) return JSON.parse(fs.readFileSync(manifest, "utf8"));
  const gitFiles = (...args) => execFileSync("git", ["ls-files", "-z", ...args], {
    cwd: root, encoding: "utf8",
  }).split("\0").filter(Boolean);
  const untracked = gitFiles("--others", "--exclude-standard");
  if (untracked.length) throw new Error(`Stage or ignore untracked files before packaging:\n${untracked.join("\n")}`);
  return gitFiles();
}

async function main() {
  const root = path.join(__dirname, "..");
  const target = process.argv[2];
  if (!["engine", "cli", "vscode-extension"].includes(target)) throw new Error("Expected engine, cli, or vscode-extension");
  const dest = path.join(root, "packages", target);
  const files = sourceFiles(root);
  if (fs.readFileSync(path.join(root, "THIRD_PARTY_NOTICES.md"), "utf8").replace(/\r\n/g, "\n") !== notices())
    throw new Error("Stale notices: run node scripts/third-party-notices.js and review the changes");
  const docs = ["README.md", "LICENSE", "LICENSING.md", "THIRD_PARTY_NOTICES.md"];
  if (target === "vscode-extension") docs.push("CHANGELOG.md", "PRIVACY.md", "DISCLAIMER.md");
  for (const file of docs) {
    let content = fs.readFileSync(path.join(root, file), "utf8");
    // vsce renames LICENSE to LICENSE.txt inside the installed extension.
    if (target === "vscode-extension" && file.endsWith(".md")) content = content.replaceAll("](LICENSE)", "](LICENSE.txt)");
    fs.writeFileSync(path.join(dest, file), content);
  }

  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "talktomebaby-source-"));
  try {
    // Use current tracked files, including staged additions. Extracted source archives
    // have the same explicit file list so repackaging does not require a Git checkout.
    for (const file of files) {
      if (path.isAbsolute(file) || file.split(/[\\/]/).includes("..")) throw new Error(`Invalid source path: ${file}`);
      fs.mkdirSync(path.dirname(path.join(stage, file)), { recursive: true });
      fs.copyFileSync(path.join(root, file), path.join(stage, file));
    }
    fs.writeFileSync(path.join(stage, "SOURCE_FILES.json"), JSON.stringify(files, null, 2) + "\n");
    for (const [dir] of dependencies) {
      fs.mkdirSync(path.dirname(path.join(stage, dir)), { recursive: true });
      fs.cpSync(path.join(root, dir), path.join(stage, dir), { recursive: true });
    }
    // npm omits preferred TypeScript source/build files for these dependencies.
    // Preserve verified upstream snapshots as well as the exact installed packages.
    const upstreamDir = path.join(stage, "upstream-sources");
    fs.mkdirSync(upstreamDir);
    for (const source of require("./upstream-sources.json")) {
      const pkg = dependencies.find(([dir]) => dir === `node_modules/${source.name}`)?.[1];
      if (pkg?.version !== source.version) throw new Error(`Update the source snapshot for ${source.name}`);
      const filename = `${source.name}-${source.version}.tar.gz`;
      const saved = path.join(root, "upstream-sources", filename);
      let bytes;
      if (fs.existsSync(saved)) bytes = fs.readFileSync(saved);
      else {
        const response = await fetch(source.url, { signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error(`Source download failed: ${source.url}: ${response.status}`);
        bytes = Buffer.from(await response.arrayBuffer());
      }
      if (createHash("sha256").update(bytes).digest("hex") !== source.sha256)
        throw new Error(`Source checksum mismatch: ${source.name}`);
      if (!fs.existsSync(saved)) {
        fs.mkdirSync(path.dirname(saved), { recursive: true });
        fs.writeFileSync(saved, bytes);
      }
      fs.writeFileSync(path.join(upstreamDir, filename), bytes);
    }
    execFileSync("tar", ["-czf", path.join(dest, "source.tar.gz"), "-C", stage, "."], { stdio: "inherit" });
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { sourceFiles };
