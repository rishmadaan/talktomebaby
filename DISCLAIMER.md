# Disclaimer

TalkToMeBaby is provided for convenience as an open-source VS Code extension. To the maximum extent permitted by applicable law, you use it entirely at your own risk.

This document is not legal advice. It is a user-facing disclaimer for the project and does not replace the GNU GPL v3 or later license, third-party provider terms, VS Code Marketplace terms, or any agreement that applies to your use of a TTS provider.

The GPL governs your rights to run, copy, modify, and distribute TalkToMeBaby. This document is informational and imposes no additional license conditions, acceptance requirement, or indemnity obligation. References to laws and external provider terms describe obligations that exist independently of this software license.

## No Warranty

TalkToMeBaby is provided "as is" and "as available", without warranties of any kind, express or implied. This includes, without limitation, warranties of merchantability, fitness for a particular purpose, non-infringement, availability, accuracy, uninterrupted operation, data security, compatibility, accessibility compliance, or error-free behavior.

No maintainer, contributor, publisher, or distributor promises that:

- audio synthesis will work for every document, provider, region, language, voice, account, network, or VS Code version;
- playback timing, highlighting, word alignment, resume behavior, cache behavior, or provider output will be accurate;
- third-party providers will remain available, affordable, compatible, lawful for your use case, or unchanged;
- local or network processing will satisfy your employer's, client's, school's, regulator's, or jurisdiction's requirements.

## User Responsibility

You are solely responsible for deciding whether TalkToMeBaby is appropriate for your use case and for everything you choose to read, transmit, synthesize, cache, store, publish, distribute, or otherwise process through it.

You are responsible for:

- complying with all laws, regulations, contracts, workplace policies, school policies, client obligations, and provider terms that apply to your use;
- ensuring you have the rights and permissions needed to process, transmit, synthesize, cache, copy, or listen to the text and audio involved;
- obtaining any required consent before processing personal data, confidential information, regulated data, copyrighted material, or third-party content;
- choosing whether a network provider is acceptable for confidential, proprietary, private, client, medical, legal, financial, educational, government, or regulated documents;
- protecting your API keys, accounts, provider quotas, paid subscriptions, local machine, VS Code profile, workspace, and generated audio cache;
- reviewing generated audio before relying on it, sharing it, publishing it, or using it in any important workflow.

## Network Providers and Third-Party Services

TalkToMeBaby can send text chunks to third-party TTS providers when you choose a network provider. Those providers are independent services with their own terms, privacy practices, rate limits, billing rules, retention practices, acceptable-use policies, outages, and content restrictions.

The project maintainers do not control third-party providers and are not responsible for their behavior, availability, pricing, outputs, data handling, account actions, policy enforcement, or changes.

The Edge TTS provider is unofficial and best effort. It uses the `msedge-tts` package and may stop working, be rate-limited, become gated, change behavior, or become unsuitable for your use without notice. You are responsible for deciding whether use of that provider is allowed for your situation. See [Microsoft Edge Voices (Edge TTS)](#microsoft-edge-voices-edge-tts) below.

## Microsoft Edge Voices (Edge TTS)

**Use the Edge TTS provider entirely at your own risk.** It is the default provider in the VS Code extension on Windows and Linux, and the default voice in the `talktomebaby` CLI on every platform. You can switch to another provider at any time.

**What it is.** The Edge TTS provider connects the machine running TalkToMeBaby directly to Microsoft's online speech service, the one behind the "Read Aloud" feature in the Microsoft Edge browser, through the open-source `msedge-tts` package (MIT). The project knows of no public documentation or licence from Microsoft for this use. TalkToMeBaby is independent, is not endorsed by Microsoft, and has no service level, support, or guarantee from Microsoft.

**What TalkToMeBaby does not do.** TalkToMeBaby does not include, bundle, host, proxy, resell, sublicense, or redistribute Microsoft voices, voice models, or Microsoft-generated audio. Audio is requested directly from Microsoft by the machine running TalkToMeBaby, only as a result of your actions, for example when you read, when you change provider or voice (the Reader prepares the next few passages in the background), when `talktomebaby install` speaks its test line, and when a CLI hook you enabled reads an agent's reply. The extension keeps generated audio in its own cache on that machine; the CLI uses temporary playback files. The project charges nothing for Edge TTS. Microsoft voice names such as `en-US-AriaNeural` are listed only so you can choose one.

**Your responsibility.** You alone decide whether Microsoft's terms, your employer's rules, and the laws where you live permit your use of this service. Microsoft may change, rate-limit, block, or shut down the service at any time, for you or for everyone. Do not sell, resell, republish, broadcast, publicly perform, use commercially, or use to train models any audio produced with Microsoft Edge voices, and do not present such audio as licensed by Microsoft or by TalkToMeBaby, unless you have confirmed you have the rights to do so. If your intended use needs specific audio rights, choose a provider or voice whose terms explicitly permit that use, and check any conditions yourself.

**Other projects do the same, and that is not permission.** Other open-source projects use the same voices. For example, Nous Research's [Hermes Agent](https://hermes-agent.nousresearch.com/docs/user-guide/features/tts) offers Edge TTS as its default free voice provider (per its documentation, October 2026), through the open-source [`edge-tts`](https://github.com/rany2/edge-tts) library. That wide use is not a licence from Microsoft, and TalkToMeBaby passes no Microsoft rights on to you.

**No Microsoft affiliation.** Microsoft and Microsoft Edge are trademarks of Microsoft Corporation; voice names are Microsoft's own identifiers for its voices. TalkToMeBaby uses them only to describe compatibility and is not affiliated with, endorsed by, or sponsored by Microsoft.

## Content, Copyright, and Generated Audio

TalkToMeBaby does not grant you rights to any document, text, voice, model, provider output, or generated audio. If you read or synthesize third-party content, you are responsible for ensuring that your use is permitted.

Generated audio may be subject to provider terms, copyright law, privacy law, publicity rights, workplace rules, educational rules, or other restrictions. Do not distribute, publish, sell, train on, broadcast, or otherwise reuse generated audio unless you have the rights and permissions to do so.

## Confidential and Regulated Data

Do not use network providers for confidential, proprietary, privileged, sensitive, regulated, or third-party data unless you have confirmed that transmission to the selected provider is permitted.

Examples include source code you do not own, client documents, private company materials, medical information, legal files, financial records, student records, government data, trade secrets, credentials, personal data, and documents covered by NDA or contractual confidentiality terms.

## Security and Data Loss

TalkToMeBaby stores API keys through VS Code SecretStorage and stores generated audio chunks in local extension storage. These mechanisms reduce obvious exposure but do not make all use risk-free.

You are responsible for your local device security, backups, VS Code profile, installed extensions, workspace trust decisions, operating system credential store, generated audio cache, and any files you choose to read.

The project is not responsible for data loss, data exposure, account compromise, API charges, quota exhaustion, cached audio contents, provider outages, incorrect output, or failure to comply with a policy or legal requirement.

## Limitation of Liability

To the maximum extent permitted by applicable law, the maintainers, contributors, publisher, and distributors of TalkToMeBaby are not liable for any direct, indirect, incidental, special, consequential, exemplary, punitive, or other damages arising from or related to your use of the extension.

This includes, without limitation, damages or losses involving data, privacy, confidentiality, intellectual property, provider accounts, API usage, billing, subscriptions, business interruption, lost profits, lost opportunities, device problems, extension behavior, generated audio, third-party services, or reliance on synthesized output.

## No Affiliation

TalkToMeBaby is independent. It is not affiliated with, endorsed by, sponsored by, or approved by Speechify, Microsoft, ElevenLabs, Sarvam AI, Apple, Visual Studio Code, or any TTS provider mentioned in the project, except where explicitly stated otherwise.

All third-party names, trademarks, services, and product names belong to their respective owners and are used only for identification, compatibility, or descriptive comparison.
