import { connection } from "next/server";
import { preparePreview } from "@/lib/sources/pexels";

export async function POST(request: Request) {
  await connection();
  let files: unknown[] = [];
  try {
    const body = (await request.json()) as { files?: unknown };
    if (Array.isArray(body.files)) files = body.files;
  } catch {
    files = [];
  }
  try {
    for (const file of files) {
      if (typeof file === "string") await preparePreview(file);
    }
    return Response.json({ ready: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return Response.json({ error: "The preview could not be prepared." }, { status: 500 });
  }
}
