import { createHash } from "node:crypto";
import path from "node:path";

export const voiceCacheDir = path.join(process.cwd(), ".voice-cache");

export function voiceTake(text: string) {
  const voiceId = process.env.ELEVENLABS_VOICE_ID ?? "";
  const modelId = process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";
  const hash = createHash("sha256").update(`${voiceId}\n${modelId}\n${text.trim()}`).digest("hex");
  return { hash, file: path.join(voiceCacheDir, `${hash}.mp3`) };
}
