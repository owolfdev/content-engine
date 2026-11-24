import { createHash } from "node:crypto";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { runFfmpeg } from "@/lib/ffmpeg";
import type { PlanShape } from "@/lib/plan";

export type PreviewShot = {
  file: string;
  start: number;
  end: number;
};

const sizes: Record<PlanShape, { width: number; height: number }> = {
  "16:9": { width: 640, height: 360 },
  "1:1": { width: 480, height: 480 },
  "9:16": { width: 360, height: 640 },
};

function publicFile(file: string) {
  if ((!file.startsWith("/library/") && !file.startsWith("/brand/")) || file.includes("..")) return null;
  return path.join(process.cwd(), "public", file.slice(1));
}

export async function splicePreview(shots: PreviewShot[], shape: PlanShape, music: string | null) {
  const usable = shots
    .filter((shot) => shot.end - shot.start >= 0.4)
    .slice(0, 6);
  if (!usable.length) throw new Error("The preview could not be prepared.");
  const sources = usable.map((shot) => {
    const full = publicFile(shot.file);
    if (!full) throw new Error("One of the clips could not be used.");
    return full;
  });
  for (const source of sources) {
    const info = await stat(source);
    if (info.size < 1000) throw new Error("The preview could not be prepared.");
  }
  const musicPath = music ? publicFile(music) : null;
  const frame = sizes[shape] ?? sizes["16:9"];
  const key = createHash("sha256")
    .update(JSON.stringify({ shape, music, shots: usable.map((shot) => [shot.file, shot.start, shot.end]) }))
    .digest("hex")
    .slice(0, 24);
  const dir = path.join(process.cwd(), "public", "library", "previews");
  const dest = path.join(dir, `${key}.mp4`);
  try {
    const existing = await stat(dest);
    if (existing.size > 20_000) return `/library/previews/${key}.mp4`;
  } catch {
    // The splice has not been made yet.
  }
  await mkdir(dir, { recursive: true });
  const partial = path.join(dir, `${key}.part.mp4`);
  const filters = usable.map((_, index) => {
    return `[${index}:v]setpts=PTS-STARTPTS,scale=${frame.width}:${frame.height}:force_original_aspect_ratio=increase,crop=${frame.width}:${frame.height},fps=30,format=yuv420p[v${index}]`;
  });
  const inputs = usable.map((_, index) => `[v${index}]`).join("");
  filters.push(`${inputs}concat=n=${usable.length}:v=1:a=0[v]`);
  const args = ["-y"];
  usable.forEach((shot, index) => {
    const seconds = Math.min(30, shot.end - shot.start);
    args.push("-ss", Math.max(0, shot.start).toFixed(2), "-t", seconds.toFixed(2), "-i", sources[index]);
  });
  if (musicPath) args.push("-i", musicPath);
  args.push("-filter_complex", filters.join(";"), "-map", "[v]");
  if (musicPath) args.push("-map", `${usable.length}:a:0`, "-shortest", "-c:a", "aac", "-b:a", "128k");
  else args.push("-an");
  args.push("-c:v", "libx264", "-preset", "veryfast", "-threads", "2", "-crf", "30", "-movflags", "+faststart", partial);
  try {
    await runFfmpeg(args);
    await rename(partial, dest);
  } catch (error) {
    await unlink(partial).catch(() => undefined);
    throw error;
  }
  return `/library/previews/${key}.mp4`;
}
