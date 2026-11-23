import { writeSync } from "node:fs";
import { cp, copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { ensureBrowser, renderMedia, selectComposition } from "@remotion/renderer";
import { mp3Seconds } from "@/lib/mp3-seconds";
import type { Plan } from "@/lib/plan";
import { renderCutProps } from "@/lib/render-cut";
import { voiceTake } from "@/lib/voice-file";

const planPath = process.argv[2];
const output = process.argv[3];
if (!planPath || !output) {
  console.error("The file could not be rendered.");
  process.exit(1);
}

let bundled: Promise<string> | null = null;

function report(update: { stage: "browser" | "bundle" | "open" | "render"; fraction?: number; remainingMs?: number | null }) {
  writeSync(1, `PROGRESS ${JSON.stringify(update)}\n`);
}

function serveUrl() {
  if (!bundled) {
    const pending = bundle({
      entryPoint: path.join(process.cwd(), "remotion/index.tsx"),
      publicDir: path.join(process.cwd(), "public"),
      symlinkPublicDir: true,
      onProgress: (value) => report({ stage: "bundle", fraction: value / 100 }),
    }).catch((error: unknown) => {
      bundled = null;
      throw error;
    });
    bundled = pending;
  }
  return bundled;
}

async function voiceFor(plan: Plan) {
  const line = plan.spokenLine.trim();
  if (!line || !process.env.ELEVENLABS_VOICE_ID) return null;
  const take = voiceTake(line);
  try {
    const info = await stat(take.file);
    if (info.size < 500) return null;
  } catch {
    return null;
  }
  const dir = path.join(process.cwd(), "public", "library", "voice");
  await mkdir(dir, { recursive: true });
  const dest = path.join(dir, `${take.hash}.mp3`);
  try {
    await stat(dest);
  } catch {
    await copyFile(take.file, dest);
  }
  const seconds = mp3Seconds(await readFile(take.file));
  return { src: `/library/voice/${take.hash}.mp3`, seconds };
}

// Chrome's helper processes cannot read icudtl.dat when the browser lives on an
// external drive and is started from the Next server. Keep a copy on the internal disk.
async function chromeExecutable() {
  const status = await ensureBrowser();
  if (!("path" in status) || !status.path) {
    throw new Error("Headless Chrome is not available on this computer.");
  }
  const destDir = path.join(os.homedir(), "Library", "Caches", "content-engine", "chrome-headless-shell");
  const dest = path.join(destDir, path.basename(status.path));
  try {
    await stat(dest);
  } catch {
    await cp(path.dirname(status.path), destDir, { recursive: true });
  }
  return dest;
}

try {
  const plan = JSON.parse(await readFile(planPath, "utf8")) as Plan;
  report({ stage: "browser" });
  const voice = await voiceFor(plan);
  const browserExecutable = await chromeExecutable();
  const inputProps = renderCutProps(plan, voice);
  const location = await serveUrl();
  report({ stage: "open" });
  const composition = await selectComposition({
    serveUrl: location,
    id: "Cut",
    inputProps,
    browserExecutable,
    timeoutInMilliseconds: 120_000,
  });
  await renderMedia({
    composition,
    serveUrl: location,
    codec: "h264",
    outputLocation: output,
    inputProps,
    browserExecutable,
    crf: 20,
    concurrency: 1,
    timeoutInMilliseconds: 120_000,
    onProgress: (update) => {
      report({
        stage: "render",
        fraction: update.progress,
        remainingMs: update.renderedFrames >= 10 && update.renderEstimatedTime > 0 ? update.renderEstimatedTime : null,
      });
    },
  });
  await writeFile(`${output}.voice`, voice ? "saved-take" : "none");
} catch (error) {
  console.error(error instanceof Error ? error.message.split("\n")[0] : "The file could not be rendered.");
  process.exit(1);
}
