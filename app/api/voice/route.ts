import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { cookies } from "next/headers";
import { styleGuide } from "@/lib/style";
import { voiceCacheDir, voiceTake } from "@/lib/voice-file";
const pending = new Map<string, Promise<{ audio: Uint8Array; charged: boolean }>>();

const cookieName = "voice-chars";

function limit(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function remainingHeader(left: number, cache: "hit" | "miss") {
  return { "x-voice-chars-left": String(left), "x-voice-cache": cache };
}

async function readCached(file: string) {
  try {
    const info = await stat(file);
    if (info.size < 500) return null;
    return new Uint8Array(await readFile(file));
  } catch {
    return null;
  }
}

function audioResponse(audio: Uint8Array, left: number, cache: "hit" | "miss") {
  return new Response(Buffer.from(audio), {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
      ...remainingHeader(left, cache),
    },
  });
}

export async function POST(request: Request) {
  const key = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  const modelId = process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";
  const lineCap = limit("ELEVENLABS_LINE_CAP", 400);
  const sessionCap = limit("ELEVENLABS_CHAR_CAP", 2000);

  let text = "";
  try {
    const body = await request.json();
    text = typeof body.text === "string" ? body.text.trim() : "";
  } catch {
    text = "";
  }
  if (!text) {
    return Response.json({ error: "Type a line first." }, { status: 400 });
  }
  if (text.length > lineCap) {
    return Response.json(
      { error: `That line is ${text.length} characters. The limit is ${lineCap}.` },
      { status: 400 },
    );
  }

  const banned = styleGuide.bannedLines.find((line) =>
    text.toLowerCase().includes(line.toLowerCase()),
  );
  if (banned) {
    return Response.json(
      { error: `“${banned}” is not used for this brand.` },
      { status: 400 },
    );
  }

  if (!voiceId) {
    return Response.json(
      { error: "ElevenLabs voice is missing." },
      { status: 503 },
    );
  }

  const takeInfo = voiceTake(text);
  const cachedFile = takeInfo.file;
  const hash = takeInfo.hash;
  const cached = await readCached(cachedFile);
  const jar = await cookies();
  const saved = jar.get(cookieName)?.value;
  const left = saved === undefined ? sessionCap : Number(saved);
  const remaining = Number.isFinite(left) ? left : sessionCap;
  if (cached) {
    return audioResponse(cached, Math.max(remaining, 0), "hit");
  }
  if (!key) {
    return Response.json(
      { error: "ElevenLabs key is missing." },
      { status: 503 },
    );
  }
  if (text.length > remaining) {
    return Response.json(
      {
        error: `This browser has ${Math.max(remaining, 0)} characters left. That line needs ${text.length}.`,
      },
      { status: 429, headers: remainingHeader(Math.max(remaining, 0), "miss") },
    );
  }

  const running = pending.get(hash);
  if (running) {
    try {
      const shared = await running;
      return audioResponse(shared.audio, remaining, "hit");
    } catch (error) {
      const message = error instanceof Error ? error.message : "ElevenLabs did not return audio.";
      return Response.json({ error: message }, { status: 502, headers: remainingHeader(remaining, "miss") });
    }
  }

  const take = (async () => {
    const again = await readCached(cachedFile);
    if (again) return { audio: again, charged: false };
    const upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
      method: "POST",
      headers: {
        "xi-api-key": key,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({ text, model_id: modelId }),
      cache: "no-store",
    });
    if (!upstream.ok) {
      const message = upstream.status === 401 ? "ElevenLabs rejected the key." : "ElevenLabs did not return audio.";
      throw new Error(message);
    }
    const audio = new Uint8Array(await upstream.arrayBuffer());
    await mkdir(voiceCacheDir, { recursive: true });
    await writeFile(cachedFile, audio);
    return { audio, charged: true };
  })();
  pending.set(hash, take);

  let result: { audio: Uint8Array; charged: boolean };
  try {
    result = await take;
  } catch (error) {
    pending.delete(hash);
    const message = error instanceof Error ? error.message : "ElevenLabs did not return audio.";
    return Response.json({ error: message }, { status: 502, headers: remainingHeader(remaining, "miss") });
  }
  pending.delete(hash);

  const nextRemaining = result.charged ? remaining - text.length : remaining;
  if (result.charged) {
    jar.set(cookieName, String(nextRemaining), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24,
    });
  }

  return audioResponse(result.audio, nextRemaining, result.charged ? "miss" : "hit");
}
