import { pexelsAt } from "@/lib/sources/pexels";
import type { PlanShape } from "@/lib/plan";

export async function POST(request: Request) {
  let body: { phrase?: unknown; shape?: unknown; index?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  const phrase = typeof body.phrase === "string" ? body.phrase.trim() : "";
  if (!phrase) {
    return Response.json({ error: "Add a search phrase." }, { status: 400 });
  }
  const shape: PlanShape = body.shape === "9:16" || body.shape === "1:1" || body.shape === "16:9" ? body.shape : "16:9";
  const index = Math.max(0, Number(body.index) || 0);
  try {
    const shot = await pexelsAt(phrase, shape, index);
    if (!shot) {
      return Response.json({ error: "No result for this phrase." }, { status: 404 });
    }
    return Response.json(shot);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pexels search failed.";
    const status = message.includes("key") ? 503 : 502;
    return Response.json({ error: message }, { status });
  }
}
