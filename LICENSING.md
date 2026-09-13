# Licensing and source code

Copyright (c) 2026 Rish.

TalkToMeBaby (the shared engine, CLI, VS Code extension, and first-party documentation and assets) is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. SPDX identifier: `GPL-3.0-or-later`.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See [LICENSE](LICENSE) for the complete GNU General Public License.

The first GPL releases are VS Code extension 0.4.0, engine 0.2.0, and CLI 0.2.0. The licensing change is recorded on 2026-09-13. Earlier MIT releases and copies already received under MIT retain their MIT permissions. Historical design documents describing MIT refer to that earlier licensing policy.

Dependencies retain their own copyright notices and licenses in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). No ownership of third-party code is claimed. External TTS services and user documents/audio are not licensed by this project; their applicable rights and terms are separate. The project disclaimer adds no restrictions to the rights granted by the GPL.

## Obtain and rebuild the matching source

Every npm package and VSIX includes `source.tar.gz` at its package root, beside this file. For a VSIX, open it as a ZIP and find `extension/source.tar.gz`. This archive contains the matching first-party source, configuration, tests, build scripts, lockfile, installed runtime dependency files, and additional upstream source snapshots for dependencies published as compiled TypeScript. You can extract it with `tar -xzf source.tar.gz` into an empty directory.

Install Node.js 20 or later and npm, then run `npm ci`, `npm run compile`, `npm test`, and `npm run build` from the extracted root. `npm ci` downloads the locked development tools and dependencies; it replaces the included `node_modules`. The original dependency files remain available in the archive. General-purpose build tools are not included. Running the test suite also requires Git for the packaging regression fixtures; rebuilding and repackaging an extracted source archive do not.

Use `npm run package` to create the VSIX, or `npm pack -w @talktomebaby/engine` / `npm pack -w talktomebaby-cli` to create npm packages. Packaging requires `tar` (available on Windows 10/11, macOS, and typical Linux installations). In a Git checkout, packaging rejects untracked, non-ignored files: add intended source files to Git and ignore only unrelated files before packaging; in an extracted archive, update `SOURCE_FILES.json` if you add or delete files. That manifest is the file list used for subsequent source archives.

`upstream-sources/` contains dependency source tarballs. Their versions, commit URLs, and SHA-256 checksums are recorded in `scripts/upstream-sources.json`. Extract each into its own directory to inspect or modify its original source and build configuration. Normal TalkToMeBaby builds consume the locked npm packages; rebuilding a modified dependency uses that upstream project's build instructions and requires replacing its installed package before rebuilding TalkToMeBaby. Packaging reuses the included verified source tarballs; a Git checkout downloads them once from the recorded URLs and caches the verified bytes in the gitignored `upstream-sources/` directory. Every reuse rechecks the checksum.

Project source and maintainer contact: <https://github.com/rishmadaan/talktomebaby>.
