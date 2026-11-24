import { connection } from "next/server";
import { splicePreview, type PreviewShot } from "@/lib/quick-preview";
import type { PlanShape } from "@/lib/plan";
import { selectionLimit } from "@/lib/chat-cut";
import { preparePreview, saveSmallProxy } from "@/lib/sources/pexels";

function readShots(value: unknown): PreviewShot[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const shot = item as { file?: unknown; start?: unknown; end?: unknown };
    if (typeof shot.file !== "string") return [];
    const start = Number(shot.start);
    const end = Number(shot.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
    return [{ file: shot.file, start, end }];
  });
}

function readShape(value: unknown): PlanShape {
  if (value === "9:16" || value === "1:1" || value === "16:9") return value;
  return "16:9";
}

export async function POST(request: Request) {
  await connection();
  let body: { files?: unknown; clips?: unknown; shape?: unknown; music?: unknown; ids?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  try {
    const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string" && /^\d+$/.test(id)) : [];
    if (ids.length) {
      const proxies = [];
      for (const id of ids.slice(0, selectionLimit)) proxies.push({ id, url: await saveSmallProxy(id) });
      return Response.json({ proxies }, { headers: { "Cache-Control": "no-store" } });
    }
    const shots = readShots(body.clips);
    if (shots.length) {
      const music = typeof body.music === "string" ? body.music : null;
      const url = await splicePreview(shots, readShape(body.shape), music);
      return Response.json({ url }, { headers: { "Cache-Control": "no-store" } });
    }
    const files = Array.isArray(body.files) ? body.files : [];
    for (const file of files) {
      if (typeof file === "string") await preparePreview(file);
    }
    return Response.json({ ready: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return Response.json({ error: "The preview could not be prepared." }, { status: 500 });
  }
}
