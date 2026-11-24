import { spawn } from "node:child_process";
import { readFile, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { connection } from "next/server";
import type { Plan } from "@/lib/plan";
import { saveMaster } from "@/lib/sources/pexels";

// Local only. Remotion's Chrome closes when this runs inside the Next.js server,
// so the route hands the plan to a separate process. A deployed site needs a different path.
const localOnly = "A video can't be made from this page.";

let rendering = false;

type Stage = "browser" | "bundle" | "open" | "render";

type RenderSnapshot = {
  progress: number;
  label: string;
  remaining: string;
  frames: string;
};

const stageRank: Record<Stage, number> = { browser: 0, bundle: 1, open: 2, render: 3 };

let snapshot: RenderSnapshot = { progress: 0, label: "", remaining: "", frames: "" };
let startedAt = 0;
let seenStage = 0;

function clock(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function timeLeft(ms: number) {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 15) return "a few seconds left";
  if (seconds < 60) return `about ${Math.ceil(seconds / 5) * 5} sec left`;
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes === 1 ? "about 1 min left" : `about ${minutes} min left`;
}

function liveProgress() {
  const elapsed = clock(Date.now() - startedAt);
  const extra = snapshot.remaining || snapshot.frames;
  return {
    running: true,
    progress: snapshot.progress,
    label: snapshot.label,
    detail: extra ? `${elapsed} elapsed · ${extra}` : `${elapsed} elapsed`,
  };
}

function describe(stage: Stage, fraction: number, remainingMs: number | null, renderedFrames: number | null, totalFrames: number | null): RenderSnapshot {
  const portion = Math.min(1, Math.max(0, fraction));
  const frames = renderedFrames != null && totalFrames ? `${renderedFrames} of ${totalFrames} frames` : "";
  const remaining = remainingMs != null && remainingMs > 0 ? timeLeft(remainingMs) : "";
  if (stage === "browser") return { progress: 0.02, label: "Starting", remaining: "", frames: "" };
  if (stage === "bundle") return { progress: 0.02 + portion * 0.18, label: "Preparing", remaining: "", frames: "" };
  if (stage === "open") return { progress: 0.2, label: "Opening the cut", remaining: "", frames: "" };
  const value = 0.2 + portion * 0.8;
  return { progress: value, label: portion > 0.92 && !remaining ? "Finishing" : "Making the video", remaining, frames };
}

function noteProgress(line: string) {
  if (!line.startsWith("PROGRESS ")) return;
  let update: { stage?: string; fraction?: number; remainingMs?: number | null; renderedFrames?: number; totalFrames?: number };
  try {
    update = JSON.parse(line.slice("PROGRESS ".length)) as typeof update;
  } catch {
    return;
  }
  if (update.stage !== "browser" && update.stage !== "bundle" && update.stage !== "open" && update.stage !== "render") return;
  const rank = stageRank[update.stage];
  if (rank < seenStage) return;
  seenStage = rank;
  const next = describe(
    update.stage,
    update.fraction ?? 0,
    typeof update.remainingMs === "number" ? update.remainingMs : null,
    typeof update.renderedFrames === "number" ? update.renderedFrames : null,
    typeof update.totalFrames === "number" ? update.totalFrames : null,
  );
  if (next.progress < snapshot.progress) return;
  snapshot = next;
}

function allowedFile(file: string) {
  return (file.startsWith("/library/") || file.startsWith("/brand/")) && !file.includes("..");
}

function renderOnThisComputer(plan: Plan, output: string) {
  const planPath = path.join(os.tmpdir(), `palm-shore-plan-${Date.now()}.json`);
  return writeFile(planPath, JSON.stringify(plan)).then(
    () =>
      new Promise<void>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            "--experimental-strip-types",
            "--import",
            path.join(process.cwd(), "scripts/alias-hook.mjs"),
            path.join(process.cwd(), "scripts/render-file.ts"),
            planPath,
            output,
          ],
          {
            cwd: process.cwd(),
            env: {
              PATH: process.env.PATH,
              HOME: process.env.HOME,
              TMPDIR: process.env.TMPDIR,
              USER: process.env.USER,
              PWD: process.cwd(),
              LANG: "en_US.UTF-8",
              LC_ALL: "en_US.UTF-8",
              NODE_ENV: process.env.NODE_ENV,
              ELEVENLABS_VOICE_ID: process.env.ELEVENLABS_VOICE_ID,
              ELEVENLABS_MODEL_ID: process.env.ELEVENLABS_MODEL_ID,
            },
            stdio: ["ignore", "pipe", "pipe"] as const,
          },
        );
        let stdout = "";
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          stdout += chunk;
          const lines = stdout.split("\n");
          stdout = lines.pop() ?? "";
          for (const line of lines) noteProgress(line);
        });
        let stderr = "";
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk: string) => {
          stderr = (stderr + chunk).slice(-2000);
        });
        child.on("error", reject);
        child.on("close", (code) => {
          unlink(planPath).catch(() => undefined);
          if (code === 0) resolve();
          else {
            const lines = stderr.trim().split("\n").filter(Boolean);
            const message = lines.find((line) => /Error|Cannot /.test(line)) || lines[0] || "The local render process failed.";
            console.error(message);
            reject(new Error(message));
          }
        });
      }),
  );
}

export async function POST(request: Request) {
  if (process.env.VERCEL) {
    return Response.json({ error: localOnly }, { status: 503 });
  }
  if (rendering) {
    return Response.json({ error: "A video is already being made. Wait for it to finish." }, { status: 409 });
  }

  let plan: Plan | null = null;
  try {
    plan = (await request.json()) as Plan;
  } catch {
    plan = null;
  }
  if (!plan || !Array.isArray(plan.clips) || plan.clips.length === 0) {
    return Response.json({ error: "Make a preview before downloading the video." }, { status: 400 });
  }
  if (plan.clips.some((clip) => !allowedFile(clip.file))) {
    return Response.json({ error: "One of the clips could not be used." }, { status: 400 });
  }

  rendering = true;
  seenStage = 0;
  startedAt = Date.now();
  snapshot = { progress: 0.02, label: "Fetching the clips", remaining: "", frames: "" };
  const output = path.join(os.tmpdir(), `palm-shore-${Date.now()}.mp4`);
  try {
    const remote = plan.clips.filter((clip) => /^\d+$/.test(clip.id));
    for (const [index, clip] of remote.entries()) {
      snapshot = { progress: 0.02 + (index / Math.max(1, remote.length)) * 0.06, label: "Fetching the clips", remaining: "", frames: "" };
      await saveMaster(clip.id);
    }
    snapshot = { progress: 0.02, label: "Starting", remaining: "", frames: "" };
    await renderOnThisComputer(plan, output);
    const file = await readFile(output);
    const voice = await readFile(`${output}.voice`, "utf8").catch(() => "none");
    return new Response(file, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": 'attachment; filename="palm-shore.mp4"',
        "Cache-Control": "no-store",
        "x-render-voice": voice.trim() === "saved-take" ? "saved-take" : "none",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : "The video could not be made.";
    console.error(message);
    return Response.json({ error: "The video could not be made. Try again in a moment." }, { status: 500 });
  } finally {
    rendering = false;
    snapshot = { progress: 0, label: "", remaining: "", frames: "" };
    await unlink(output).catch(() => undefined);
    await unlink(`${output}.voice`).catch(() => undefined);
  }
}

export async function GET() {
  await connection();
  return Response.json(rendering ? liveProgress() : { running: false, progress: 0, label: "", detail: "" }, {
    headers: { "Cache-Control": "no-store" },
  });
}
