// Copyright (c) 2026 Rish
// SPDX-License-Identifier: GPL-3.0-or-later
// See LICENSE and LICENSING.md for licensing and warranty information.
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
const dependencies = Object.entries(lock.packages).filter(([dir, pkg]) =>
  dir.includes("node_modules/") && !pkg.dev && !pkg.link);

function readmeLicense(body) {
  const start = body.indexOf("(The MIT License)");
  if (start < 0) throw new Error("Missing MIT license marker in dependency README; review its license notice");
  return body.slice(start).split(/\n\[/)[0].trim();
}

function notices() {
  let output = "# Third-Party Notices\n\nTalkToMeBaby is licensed under GPL-3.0-or-later. Dependencies retain their own licenses below.\n\nGenerated from the installed production dependencies in package-lock.json with `node scripts/third-party-notices.js`. Includes dependencies bundled into the CLI and VS Code extension, and used by the engine.\n";
  for (const [dir, pkg] of dependencies) {
    const installed = JSON.parse(fs.readFileSync(path.join(root, dir, "package.json"), "utf8"));
    if (installed.version !== pkg.version || installed.license !== pkg.license)
      throw new Error(`Dependency metadata differs from lockfile: ${dir}; run npm ci`);
    if (!["MIT", "ISC", "BSD-3-Clause"].includes(pkg.license))
      throw new Error(`Review the new dependency license before packaging: ${dir}: ${pkg.license}`);
    const files = fs.readdirSync(path.join(root, dir)).filter(f => /^(licen[cs]e|copying|notice)(\.|$)/i.test(f));
    // These two upstream packages publish their complete MIT notice in README.md.
    if (!files.length && ["agent-base", "https-proxy-agent"].includes(installed.name)) files.push("README.md");
    if (!files.length) throw new Error(`Missing license notice: ${dir}`);
    output += `\n## ${installed.name} ${pkg.version} (${pkg.license})\n\nLocation: \`${dir}\`\n`;
    for (const file of files) {
      let body = fs.readFileSync(path.join(root, dir, file), "utf8").replace(/\r\n/g, "\n");
      if (file === "README.md") body = readmeLicense(body);
      output += `\nFrom ${file}:\n\n\`\`\`text\n${body.trim()}\n\`\`\`\n`;
    }
  }
  return output;
}

if (require.main === module) fs.writeFileSync(path.join(root, "THIRD_PARTY_NOTICES.md"), notices());
module.exports = { dependencies, notices, readmeLicense };
