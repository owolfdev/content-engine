import { spawn } from "node:child_process";
import { readFile, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Plan } from "@/lib/plan";

// Local only. Remotion's Chrome closes when this runs inside the Next.js server,
// so the route hands the plan to a separate process. A deployed site needs a different path.
const localOnly = "This render runs on the local server. A deployed site cannot make this file and needs a different render path.";

let rendering = false;

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
            stdio: ["ignore", "ignore", "pipe"],
          },
        );
        let stderr = "";
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk: string) => {
          stderr = (stderr + chunk).slice(-2000);
        });
        child.on("error", reject);
        child.on("close", (code) => {
          unlink(planPath).catch(() => undefined);
          if (code === 0) resolve();
          else reject(new Error(stderr.trim().split("\n").filter(Boolean).at(-1) || "The local render process failed."));
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
    await unlink(output).catch(() => undefined);
    await unlink(`${output}.voice`).catch(() => undefined);
  }
}
