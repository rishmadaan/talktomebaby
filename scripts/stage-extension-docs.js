// Stages the root marketplace docs into packages/vscode-extension so vsce
// bundles them into the VSIX. Cross-platform (the prepackage script runs
// through cmd.exe on Windows, where cp does not exist).
const { copyFileSync } = require("fs");
const { join } = require("path");

const root = join(__dirname, "..");
const dest = join(root, "packages", "vscode-extension");
for (const f of ["README.md", "CHANGELOG.md", "LICENSE", "PRIVACY.md", "DISCLAIMER.md", "THIRD_PARTY_NOTICES.md"]) {
  copyFileSync(join(root, f), join(dest, f));
}
