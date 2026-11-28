import { connection } from "next/server";
import { browsePexels } from "@/lib/sources/pexels";

export async function POST(request: Request) {
  await connection();
  let body: { query?: unknown; page?: unknown; perPage?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) return Response.json({ error: "Add a search phrase." }, { status: 400 });
  const page = Math.min(500, Math.max(1, Math.floor(Number(body.page)) || 1));
  const perPage = Math.min(80, Math.max(4, Math.floor(Number(body.perPage)) || 12));
  try {
    const found = await browsePexels(query, "16:9", page, perPage);
    return Response.json({ ...found, page, perPage }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const missing = message.includes("key");
    return Response.json(
      { error: missing ? "Footage is unavailable right now." : "The search did not go through. Try again." },
      { status: missing ? 503 : 502 },
    );
  }
}
