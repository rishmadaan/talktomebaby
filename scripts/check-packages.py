# Copyright (c) 2026 Rish
# SPDX-License-Identifier: GPL-3.0-or-later
# See LICENSE and LICENSING.md for licensing and warranty information.
"""Check real release artifacts after npm run package and both npm pack commands."""
import hashlib
import io
import json
from pathlib import Path
import tarfile
import zipfile

root = Path(__file__).resolve().parent.parent
docs = ("LICENSE", "LICENSING.md", "THIRD_PARTY_NOTICES.md")
for workspace in ("engine", "cli", "vscode-extension"):
    package = json.loads((root / "packages" / workspace / "package.json").read_text())
    if workspace == "vscode-extension":
        artifact = root / "packages/vscode-extension/talktomebaby.vsix"
        with zipfile.ZipFile(artifact) as archive:
            contents = {name.removeprefix("extension/"): archive.read(name)
                        for name in archive.namelist() if name.startswith("extension/") and not name.endswith("/")}
            contents["LICENSE"] = contents["LICENSE.txt"]
    else:
        filename = package["name"].lstrip("@").replace("/", "-") + "-" + package["version"] + ".tgz"
        artifact = root / ".artifacts" / filename
        with tarfile.open(artifact) as archive:
            contents = {member.name.removeprefix("package/"): archive.extractfile(member).read()
                        for member in archive.getmembers() if member.isfile()}
    actual = json.loads(contents["package.json"])
    assert actual["license"] == "GPL-3.0-or-later", artifact
    assert actual["version"] == package["version"], artifact
    for doc in docs:
        expected = (root / doc).read_text(encoding="utf-8")
        if workspace == "vscode-extension" and doc.endswith(".md"):
            expected = expected.replace("](LICENSE)", "](LICENSE.txt)")
        assert contents[doc].decode().replace("\r\n", "\n") == expected, (artifact, doc)
    with tarfile.open(fileobj=io.BytesIO(contents["source.tar.gz"])) as source:
        def read(name):
            return source.extractfile("./" + name).read()

        files = json.loads(read("SOURCE_FILES.json"))
        for name in ("LICENSE", "LICENSING.md", "package-lock.json", "scripts/stage-package-docs.js",
                     "packages/engine/src/index.ts", "packages/cli/src/cli.ts", "packages/vscode-extension/src/extension.ts"):
            assert name in files, (artifact, name)
        for name in files:
            assert read(name) == (root / name).read_bytes(), (artifact, "source mismatch", name)
        locked = json.loads(read("package-lock.json"))["packages"]
        for directory, dependency in locked.items():
            if "node_modules/" in directory and not dependency.get("dev") and not dependency.get("link"):
                installed = json.loads(read(directory + "/package.json"))
                assert installed["version"] == dependency["version"], (artifact, directory)
        for upstream in json.loads(read("scripts/upstream-sources.json")):
            name = f'upstream-sources/{upstream["name"]}-{upstream["version"]}.tar.gz'
            assert hashlib.sha256(read(name)).hexdigest() == upstream["sha256"], (artifact, name)
    print(f"Verified {artifact.name}: metadata, licenses, matching source, runtime dependencies, upstream snapshots")
