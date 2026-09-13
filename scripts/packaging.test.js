// Copyright (c) 2026 Rish
// SPDX-License-Identifier: GPL-3.0-or-later
// See LICENSE and LICENSING.md for licensing and warranty information.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { sourceFiles } = require("./stage-package-docs");
const { readmeLicense } = require("./third-party-notices");

test("packaging rejects an imported untracked source until it is staged", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "talktomebaby-packaging-test-"));
  try {
    const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
    git("init");
    fs.mkdirSync(path.join(root, "packages/cli/src"), { recursive: true });
    fs.writeFileSync(path.join(root, "packages/cli/src/index.ts"), 'import "./new-file";\n');
    fs.writeFileSync(path.join(root, ".gitignore"), "upstream-sources/\n");
    git("add", ".");
    fs.writeFileSync(path.join(root, "packages/cli/src/new-file.ts"), "export {};\n");
    assert.throws(() => sourceFiles(root), /Stage or ignore.*\npackages\/cli\/src\/new-file.ts/);
    git("add", ".");
    fs.mkdirSync(path.join(root, "upstream-sources"));
    fs.writeFileSync(path.join(root, "upstream-sources/cached.tar.gz"), "ignored cache");
    assert(sourceFiles(root).includes("packages/cli/src/new-file.ts"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an extracted archive uses its manifest without a Git repository", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "talktomebaby-manifest-test-"));
  try {
    fs.writeFileSync(path.join(root, "SOURCE_FILES.json"), '["LICENSE"]');
    assert.deepEqual(sourceFiles(root), ["LICENSE"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("README notice extraction fails closed if the license marker disappears", () => {
  assert.throws(() => readmeLicense("Copyright notice with a changed heading\n"), /Missing MIT license marker/);
  assert.equal(readmeLicense("Intro\n(The MIT License)\nCopyright\nPermission\n[link]: example.com"),
    "(The MIT License)\nCopyright\nPermission");
});
