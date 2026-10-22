import { compileScript } from "@/lib/compile";
import type { Script } from "@/lib/script";

export async function POST(request: Request) {
  let script: Script | null = null;
  try {
    script = (await request.json()) as Script;
  } catch {
    script = null;
  }
  if (!script || !Array.isArray(script.beats)) {
    return Response.json({ error: "The script is missing." }, { status: 400 });
  }
  try {
    return Response.json(await compileScript(script));
  } catch (error) {
    const message = error instanceof Error ? error.message : "The preview could not be built.";
    const status = message.includes("key") ? 503 : 502;
    return Response.json({ error: message }, { status });
  }
}
