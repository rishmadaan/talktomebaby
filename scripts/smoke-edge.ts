import { writeFileSync } from "fs";
import { EdgeProvider } from "../packages/engine/src/synthesis/edge";
import { parseDocument } from "../packages/engine/src/core/document-model";
import { buildChunks } from "../packages/engine/src/core/chunker";

async function main() {
  const model = parseDocument(
    "TalkToMeBaby is a reading companion. It highlights every word as it speaks. Try it now!",
    "smoke.txt", 1
  );
  const [chunk] = buildChunks(model);
  const provider = new EdgeProvider();
  const result = await provider.synthesize(chunk, provider.defaultVoice, new AbortController().signal);
  writeFileSync("/tmp/talktomebaby-smoke.mp3", Buffer.from(result.audio));
  console.log("audio bytes:", result.audio.byteLength);
  console.log("chunk words:", chunk.words.length);
  console.log("timed words:", result.timings.words.length);
  console.log("timings:", JSON.stringify(result.timings, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
