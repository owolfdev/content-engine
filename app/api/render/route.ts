import { spawn } from "node:child_process";
import { readFile, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { connection } from "next/server";
import type { Plan } from "@/lib/plan";

// Local only. Remotion's Chrome closes when this runs inside the Next.js server,
// so the route hands the plan to a separate process. A deployed site needs a different path.
const localOnly = "This render runs on the local server. A deployed site cannot make this file and needs a different render path.";

let rendering = false;

type Stage = "browser" | "bundle" | "open" | "render";

type RenderProgress = {
  running: boolean;
  progress: number;
  label: string;
};

const stageRank: Record<Stage, number> = { browser: 0, bundle: 1, open: 2, render: 3 };

let progress: RenderProgress = { running: false, progress: 0, label: "" };
let seenStage = 0;

function timeLeft(ms: number) {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 15) return "a few seconds left";
  if (seconds < 60) return `about ${Math.ceil(seconds / 5) * 5} sec left`;
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes === 1 ? "about 1 min left" : `about ${minutes} min left`;
}

function describe(stage: Stage, fraction: number, remainingMs: number | null): RenderProgress {
  const portion = Math.min(1, Math.max(0, fraction));
  if (stage === "browser") return { running: true, progress: 0.02, label: "Opening the browser · 2%" };
  if (stage === "bundle") {
    const value = 0.02 + portion * 0.18;
    return { running: true, progress: value, label: `Preparing the project · ${Math.round(value * 100)}%` };
  }
  if (stage === "open") return { running: true, progress: 0.2, label: "Opening the composition · 20%" };
  const value = 0.2 + portion * 0.8;
  const percent = Math.round(value * 100);
  const label =
    portion > 0.92 && remainingMs == null
      ? `Finishing the file · ${percent}%`
      : remainingMs == null
        ? `Rendering · ${percent}%`
        : `Rendering · ${percent}% · ${timeLeft(remainingMs)}`;
  return { running: true, progress: value, label };
}

function noteProgress(line: string) {
  if (!line.startsWith("PROGRESS ")) return;
  let update: { stage?: string; fraction?: number; remainingMs?: number | null };
  try {
    update = JSON.parse(line.slice("PROGRESS ".length)) as typeof update;
  } catch {
    return;
  }
  if (update.stage !== "browser" && update.stage !== "bundle" && update.stage !== "open" && update.stage !== "render") return;
  const rank = stageRank[update.stage];
  if (rank < seenStage) return;
  seenStage = rank;
  const next = describe(update.stage, update.fraction ?? 0, typeof update.remainingMs === "number" ? update.remainingMs : null);
  if (next.progress < progress.progress) return;
  progress = next;
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
              ELEVENLABS_VOICE_ID: process.env.ELEVENLABS_VOICE_ID,
              ELEVENLABS_MODEL_ID: process.env.ELEVENLABS_MODEL_ID,
            },
            stdio: ["ignore", "pipe", "pipe"],
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
    return Response.json({ error: "A render is already running on this computer." }, { status: 409 });
  }

  let plan: Plan | null = null;
  try {
    plan = (await request.json()) as Plan;
  } catch {
    plan = null;
  }
  if (!plan || !Array.isArray(plan.clips) || plan.clips.length === 0) {
    return Response.json({ error: "Assemble a preview before rendering a file." }, { status: 400 });
  }
  if (plan.clips.some((clip) => !allowedFile(clip.file))) {
    return Response.json({ error: "A shot file is outside the local library." }, { status: 400 });
  }

  rendering = true;
  seenStage = 0;
  progress = { running: true, progress: 0.02, label: "Opening the browser · 2%" };
  const output = path.join(os.tmpdir(), `palm-shore-${Date.now()}.mp4`);
  try {
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
    const message = error instanceof Error ? error.message.split("\n")[0] : "The file could not be rendered.";
    return Response.json({ error: message }, { status: 500 });
  } finally {
    rendering = false;
    progress = { running: false, progress: 0, label: "" };
    await unlink(output).catch(() => undefined);
    await unlink(`${output}.voice`).catch(() => undefined);
  }
}

export async function GET() {
  await connection();
  return Response.json(rendering ? progress : { running: false, progress: 0, label: "" }, {
    headers: { "Cache-Control": "no-store" },
  });
}
