import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export function runFfmpeg(args: string[]) {
  const dir = path.join(process.cwd(), "node_modules", "@remotion", `compositor-${process.platform}-${process.arch}`);
  const bundled = path.join(dir, "ffmpeg");
  const bin = existsSync(bundled) ? bundled : "ffmpeg";
  const env = existsSync(bundled) ? { ...process.env, DYLD_LIBRARY_PATH: dir, LD_LIBRARY_PATH: dir } : process.env;
  return new Promise<void>((resolve, reject) => {
    const child = spawn(bin, args, { env, stdio: ["ignore", "ignore", "pipe"] as const });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-2000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim().split("\n").filter(Boolean).at(-1) || "The preview could not be prepared."));
    });
  });
}
